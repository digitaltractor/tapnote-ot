import SwiftUI
import SwiftData
import TapNoteCore

/// In-session tap capture. For a group, a switcher at the top picks which student the taps apply to.
struct SessionCaptureView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(Preferences.self) private var preferences
    @Query private var group: [SessionRecord]
    @State private var selectedCode: String?
    @State private var showDetails = false
    private let time = TimeStyle()

    init(groupKey: UUID) {
        _group = Query(filter: #Predicate<SessionRecord> { $0.groupKey == groupKey }, sort: \SessionRecord.date)
    }

    private var sessions: [SessionRecord] {
        group.sorted { $0.studentCode < $1.studentCode }
    }

    private var current: SessionRecord? {
        sessions.first { $0.studentCode == selectedCode } ?? sessions.first
    }

    var body: some View {
        Group {
            if let session = current {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if sessions.count > 1 { studentSwitcher }
                        if session.isSigned {
                            Label("This note is signed and locked. Changes go in an addendum on the Review tab.", systemImage: "lock.fill")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        CaptureForm(session: session, preferences: preferences)
                            .disabled(session.isSigned)
                    }
                    .padding()
                }
                .background(Color(.systemGroupedBackground))
                .safeAreaInset(edge: .bottom) { endBar(session) }
            } else {
                ContentUnavailableView("Session not found", systemImage: "questionmark")
            }
        }
        .navigationTitle(current.map { sessions.count > 1 ? "Group of \(sessions.count)" : $0.studentCode } ?? "Session")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showDetails = true } label: { Label("Session details", systemImage: "slider.horizontal.3") }
            }
        }
        .sheet(isPresented: $showDetails) {
            SessionDetailsSheet(sessions: sessions)
        }
        .onDisappear { scrubComments(); try? context.save() }
    }

    private var studentSwitcher: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(sessions) { s in
                    Button {
                        scrubComments()
                        selectedCode = s.studentCode
                    } label: {
                        VStack(spacing: 0) {
                            Text(s.studentCode).font(.subheadline.monospaced())
                            Text(s.student?.alias ?? "").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(ChipButtonStyle(selected: s.id == current?.id, minHeight: 52))
                }
            }
        }
    }

    private func endBar(_ session: SessionRecord) -> some View {
        HStack {
            if let start = session.start {
                Text("Started \(time.time(start))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if session.end == nil && session.attendance.serviceDelivered {
                Button {
                    endSession()
                } label: {
                    Text("End session").font(.headline).frame(minWidth: 140, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
            } else if let end = session.end {
                Text("Ended \(time.time(end))").font(.subheadline.weight(.semibold))
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private func endSession() {
        let now = Date.now
        for s in sessions where s.end == nil && s.attendance.serviceDelivered {
            s.end = now
            context.audit("Session", s.id.uuidString, "ended", s.studentCode)
        }
        scrubComments()
        try? context.save()
        dismiss()
    }

    /// Replace any real name typed into a comment with the student's code before it is stored.
    private func scrubComments() {
        let names = IdentityVault.namesForScrubbing()
        guard !names.isEmpty else { return }
        for s in sessions where !s.isSigned && !s.comment.isEmpty {
            let result = NameScrubber.scrub(s.comment, names: names)
            if result.replacements > 0 {
                s.comment = result.text
                context.audit("Session", s.id.uuidString, "scrubbed names", "\(result.replacements) replaced")
            }
        }
    }
}

/// The tap targets for one student's session.
private struct CaptureForm: View {
    @Bindable var session: SessionRecord
    let preferences: Preferences

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if !session.attendance.serviceDelivered {
                Label(session.attendance.label + ". No service is recorded for this session.", systemImage: "person.fill.xmark")
                    .foregroundStyle(Theme.warning)
            } else {
                activities
                ForEach(session.student?.activeGoals ?? []) { goal in
                    GoalCard(session: session, goal: goal, promptLevels: preferences.enabledPromptLevels)
                }
                if (session.student?.activeGoals ?? []).isEmpty {
                    Text("No goals yet. Add IEP goals for this student on the Students tab.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                regulation
                engagement
                progress
                comment
            }
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text).font(.subheadline.weight(.bold)).foregroundStyle(.secondary)
    }

    private var activities: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Activities")
            FlowLayout(spacing: 8) {
                ForEach(preferences.activityCatalog) { activity in
                    let on = session.activities.contains { $0.id == activity.id }
                    Button(activity.name) { session.toggle(activity) }
                        .buttonStyle(ChipButtonStyle(selected: on))
                }
            }
        }
    }

    private var regulation: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Regulation")
            HStack(spacing: 6) {
                ForEach(RegulationState.allCases) { state in
                    Button {
                        session.regulation = session.regulation == state ? nil : state
                    } label: {
                        Text(state.rawValue).lineLimit(1).minimumScaleFactor(0.8).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(ChipButtonStyle(selected: session.regulation == state, fill: Theme.regulationFill(state.rawValue), minHeight: 48))
                }
            }
        }
    }

    private var engagement: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Engagement (1 low – 5 high)")
            HStack(spacing: 6) {
                ForEach(1...5, id: \.self) { n in
                    Button {
                        session.engagement = session.engagement == n ? nil : n
                    } label: {
                        Text("\(n)").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(ChipButtonStyle(selected: session.engagement == n, minHeight: 48))
                }
            }
        }
    }

    private var progress: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Session progress")
            FlowLayout(spacing: 6) {
                ForEach(ProgressIndicator.allCases) { p in
                    Button(p.label) { session.progress = session.progress == p ? nil : p }
                        .buttonStyle(ChipButtonStyle(selected: session.progress == p))
                }
            }
        }
    }

    private var comment: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Quick comment (optional)")
            TextField("e.g. used slant board", text: $session.comment, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
            Text("Any student name typed here is replaced with the code when you leave this screen.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct GoalCard: View {
    @Bindable var session: SessionRecord
    let goal: GoalRecord
    let promptLevels: [PromptLevel]

    private var obs: GoalObservation { session.observation(for: goal.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Goal \(goal.number) · \(goal.shortName)").font(.headline)
                Spacer()
                Button("Reset") { session.updateObservation(goalID: goal.id) { $0.correct = 0; $0.total = 0 } }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                Button {
                    session.updateObservation(goalID: goal.id) { $0.correct += 1; $0.total += 1 }
                } label: {
                    Text("Correct").font(.title3.weight(.bold)).frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent)

                Button {
                    session.updateObservation(goalID: goal.id) { $0.total += 1 }
                } label: {
                    Text("Miss").font(.title3.weight(.bold)).frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.bordered)

                VStack(alignment: .trailing, spacing: 0) {
                    Text(obs.percent.map { "\($0)%" } ?? "—").font(.title2.weight(.bold))
                    Text("\(obs.correct) / \(obs.total)").font(.footnote).foregroundStyle(.secondary)
                }
                .frame(width: 72, alignment: .trailing)
                .accessibilityElement(children: .combine)
            }
            Text("Prompt level").font(.footnote).foregroundStyle(.secondary)
            FlowLayout(spacing: 6) {
                ForEach(promptLevels) { level in
                    Button(level.shortName) {
                        session.updateObservation(goalID: goal.id) { $0.promptLevelName = $0.promptLevelName == level.name ? nil : level.name }
                    }
                    .buttonStyle(ChipButtonStyle(selected: obs.promptLevelName == level.name))
                    .accessibilityLabel(level.name)
                }
            }
        }
        .padding()
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(.secondarySystemGroupedBackground)))
    }
}

/// Attendance, delivery, make-up flag and exact times for the whole group.
private struct SessionDetailsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    let sessions: [SessionRecord]
    @State private var attendance: Attendance = .present
    @State private var delivery: Delivery = .inPerson
    @State private var makeUp = false
    @State private var start = Date.now
    @State private var end = Date.now
    @State private var hasEnd = false

    var body: some View {
        NavigationStack {
            Form {
                Picker("Attendance", selection: $attendance) {
                    ForEach(Attendance.allCases) { Text($0.label).tag($0) }
                }
                Picker("Delivery", selection: $delivery) {
                    ForEach(Delivery.allCases) { Text($0.label).tag($0) }
                }
                Toggle("Make-up session", isOn: $makeUp)
                Section {
                    DatePicker("Start", selection: $start, displayedComponents: [.hourAndMinute])
                    Toggle("Ended", isOn: $hasEnd)
                    if hasEnd {
                        DatePicker("End", selection: $end, in: start..., displayedComponents: [.hourAndMinute])
                    }
                } footer: {
                    Text("Exact times only. Minutes are never rounded up.")
                }
            }
            .navigationTitle("Session details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() } }
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        guard let s = sessions.first else { return }
        attendance = s.attendance
        delivery = s.delivery
        makeUp = s.isMakeUp
        start = s.start ?? s.date
        if let e = s.end { end = e; hasEnd = true } else { end = start.addingTimeInterval(30 * 60) }
    }

    private func save() {
        for s in sessions where !s.isSigned {
            s.attendance = attendance
            s.delivery = delivery
            s.isMakeUp = makeUp && attendance.serviceDelivered
            s.start = attendance.serviceDelivered ? start : nil
            s.end = attendance.serviceDelivered && hasEnd ? end : nil
            context.audit("Session", s.id.uuidString, "edited details", "\(attendance.rawValue) \(delivery.rawValue)")
        }
        try? context.save()
        dismiss()
    }
}
