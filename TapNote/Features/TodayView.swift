import SwiftUI
import SwiftData
import TapNoteCore

struct GroupRoute: Hashable, Identifiable {
    let key: UUID
    var id: UUID { key }
}

/// One row per session group (an individual session is a group of one).
struct SessionGroup: Identifiable {
    let key: UUID
    let sessions: [SessionRecord]
    var id: UUID { key }

    var codes: String { sessions.map(\.studentCode).joined(separator: ", ") }
    var first: SessionRecord { sessions[0] }
    var isInProgress: Bool { sessions.contains(where: \.isInProgress) }
    var allSigned: Bool { sessions.allSatisfy(\.isSigned) }

    static func make(_ records: [SessionRecord]) -> [SessionGroup] {
        let grouped = Dictionary(grouping: records, by: \.groupKey)
        return grouped.map { SessionGroup(key: $0.key, sessions: $0.value.sorted { $0.studentCode < $1.studentCode }) }
            .sorted { ($0.first.start ?? $0.first.date) < ($1.first.start ?? $1.first.date) }
    }
}

struct TodayView: View {
    @Query(sort: \SessionRecord.date) private var sessions: [SessionRecord]
    @State private var showingStart = false
    @State private var route: GroupRoute?
    private let time = TimeStyle()

    private var todaysGroups: [SessionGroup] {
        SessionGroup.make(sessions.filter { Calendar.current.isDateInToday($0.date) })
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        showingStart = true
                    } label: {
                        Label("Start a session", systemImage: "play.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                }

                if todaysGroups.isEmpty {
                    Section {
                        ContentUnavailableView("No sessions yet today", systemImage: "calendar", description: Text("Start a session, or mark a student absent, from the button above."))
                    }
                } else {
                    Section("Today") {
                        ForEach(todaysGroups) { group in
                            Button {
                                route = GroupRoute(key: group.key)
                            } label: {
                                TodayRow(group: group, time: time)
                            }
                            .foregroundStyle(.primary)
                        }
                    }
                }
            }
            .navigationTitle(Date.now.formatted(.dateTime.weekday(.wide).month().day()))
            .navigationDestination(item: $route) { route in
                SessionCaptureView(groupKey: route.key)
            }
            .sheet(isPresented: $showingStart) {
                StartSessionSheet { key in
                    showingStart = false
                    if let key { route = GroupRoute(key: key) }
                }
            }
        }
    }
}

private struct TodayRow: View {
    let group: SessionGroup
    let time: TimeStyle

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(group.first.start.map(time.time) ?? "—")
                .font(.subheadline.weight(.bold))
                .frame(width: 72, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(group.codes)
                    .font(.body.monospaced())
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            badge
        }
        .padding(.vertical, 4)
    }

    private var subtitle: String {
        let s = group.first
        if !s.attendance.serviceDelivered { return s.attendance.label }
        let kind = group.sessions.count > 1 ? "Group of \(group.sessions.count)" : "Individual"
        return "\(kind) · \(s.student?.alias ?? "")"
    }

    @ViewBuilder private var badge: some View {
        if group.allSigned {
            StatusBadge(text: "Signed", kind: .ok)
        } else if group.isInProgress {
            StatusBadge(text: "In progress", kind: .neutral)
        } else if !group.first.attendance.serviceDelivered {
            StatusBadge(text: "Absent", kind: .warning)
        } else {
            StatusBadge(text: "To review", kind: .neutral)
        }
    }
}

/// Pick one student (individual) or several (group), or log an absence.
struct StartSessionSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(Preferences.self) private var preferences
    @Query(filter: #Predicate<StudentRecord> { $0.isActive }, sort: \StudentRecord.code) private var students: [StudentRecord]
    @State private var selected: Set<String> = []
    @State private var attendance: Attendance = .present
    @State private var makeUp = false
    var onDone: (UUID?) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Attendance", selection: $attendance) {
                        ForEach(Attendance.allCases) { Text($0.label).tag($0) }
                    }
                    if attendance == .present {
                        Toggle("Make-up session", isOn: $makeUp)
                    }
                } footer: {
                    Text(selected.count > 1 ? "Group session: one timer, separate trials and ratings for each student." : "Pick two or more students for a group session.")
                }

                Section("Students") {
                    if students.isEmpty {
                        Text("Add students on the Students tab first.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(students) { student in
                        Button {
                            if selected.contains(student.code) { selected.remove(student.code) } else { selected.insert(student.code) }
                        } label: {
                            HStack {
                                Image(systemName: selected.contains(student.code) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(selected.contains(student.code) ? Theme.accent : .secondary)
                                Text(student.code).font(.body.monospaced())
                                Text(student.alias).foregroundStyle(.secondary)
                            }
                            .frame(minHeight: 44)
                        }
                        .foregroundStyle(.primary)
                    }
                }
            }
            .navigationTitle("New session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDone(nil) }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(attendance == .present ? "Start" : "Log") { start() }
                        .disabled(selected.isEmpty)
                }
            }
        }
    }

    private func start() {
        let chosen = students.filter { selected.contains($0.code) }
        guard !chosen.isEmpty else { return }
        let key = UUID()
        let now = Date.now
        for student in chosen {
            let delivered = attendance.serviceDelivered
            let session = SessionRecord(student: student, groupKey: key, groupSize: chosen.count,
                                        start: delivered ? now : nil,
                                        plannedMinutes: preferences.defaultSessionMinutes,
                                        attendance: attendance)
            session.date = now
            session.isMakeUp = delivered && makeUp
            context.insert(session)
            context.audit("Session", session.id.uuidString, delivered ? "started" : "logged \(attendance.rawValue)", student.code)
        }
        try? context.save()
        onDone(attendance.serviceDelivered ? key : nil)
    }
}
