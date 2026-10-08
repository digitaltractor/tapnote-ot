import SwiftUI
import SwiftData
import TapNoteCore

/// End-of-day review: every session for the chosen day, its self-audit status, and sign-off.
struct ReviewView: View {
    @Environment(\.modelContext) private var context
    @Environment(Preferences.self) private var preferences
    @Query(sort: \SessionRecord.date) private var allSessions: [SessionRecord]
    @State private var day = Date.now
    @State private var message: String?
    private let time = TimeStyle()

    private var daySessions: [SessionRecord] {
        allSessions
            .filter { Calendar.current.isDate($0.date, inSameDayAs: day) }
            .sorted { ($0.start ?? $0.date, $0.studentCode) < ($1.start ?? $1.date, $1.studentCode) }
    }

    private func issues(_ s: SessionRecord) -> [AuditIssue] {
        SelfAudit.check(s.snapshot, sameDay: daySessions.map(\.snapshot))
    }

    private var readyToSign: [SessionRecord] {
        daySessions.filter { !$0.isSigned && !$0.isInProgress && SelfAudit.isReadyToSign(issues($0)) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    DatePicker("Day", selection: $day, displayedComponents: [.date])
                    if !readyToSign.isEmpty {
                        Button {
                            Task { await signAll() }
                        } label: {
                            Label("Sign all ready (\(readyToSign.count))", systemImage: "signature")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                } footer: {
                    let signed = daySessions.filter(\.isSigned).count
                    Text("\(signed) of \(daySessions.count) signed. Drafts are written from your taps; open one to edit before signing.")
                }

                Section("Sessions") {
                    if daySessions.isEmpty {
                        Text("No sessions on this day.").foregroundStyle(.secondary)
                    }
                    ForEach(daySessions) { session in
                        NavigationLink {
                            NoteDetailView(session: session, sameDay: daySessions)
                        } label: {
                            ReviewRow(session: session, issues: issues(session), time: time)
                        }
                    }
                }
            }
            .navigationTitle("Review")
            .alert("Signing", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(message ?? "")
            }
        }
    }

    private func signAll() async {
        let targets = readyToSign
        guard await Authenticator.authenticate(reason: "Sign \(targets.count) notes") else {
            message = "Face ID or passcode is needed to sign."
            return
        }
        let composer = NoteComposer(timeStyle: time)
        for s in targets {
            NoteSigner.sign(s, text: s.noteText ?? composer.compose(s.snapshot, format: preferences.noteFormat).plainText, format: preferences.noteFormat, signer: preferences.signature, context: context)
        }
        try? context.save()
        message = "Signed \(targets.count) notes."
    }
}

enum NoteSigner {
    static func sign(_ s: SessionRecord, text: String, format: NoteFormat, signer: String, context: ModelContext) {
        guard !s.isSigned else { return }
        s.noteText = text
        s.noteFormatRaw = format.rawValue
        s.signedAt = .now
        s.signerName = signer
        context.audit("Note", s.id.uuidString, "signed and locked", "\(s.studentCode) by \(signer)")
    }
}

private struct ReviewRow: View {
    let session: SessionRecord
    let issues: [AuditIssue]
    let time: TimeStyle

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(session.start.map(time.time) ?? "—") · \(session.studentCode)")
                    .font(.body.monospaced())
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            badge
        }
        .padding(.vertical, 2)
    }

    private var subtitle: String {
        guard session.attendance.serviceDelivered else { return "\(session.attendance.label) · log entry only" }
        let kind = session.groupSize > 1 ? "Group of \(session.groupSize)" : "Individual"
        if let m = session.snapshot.minutes { return "\(kind) · \(m) min" }
        return kind
    }

    @ViewBuilder private var badge: some View {
        if session.isSigned {
            StatusBadge(text: "Signed", kind: .ok)
        } else if session.isInProgress {
            StatusBadge(text: "In progress", kind: .neutral)
        } else if let first = issues.first(where: { $0.severity == .blocking }) {
            StatusBadge(text: first.message.count > 22 ? "Needs fixes" : first.message, kind: .warning)
        } else {
            StatusBadge(text: "Ready", kind: .neutral)
        }
    }
}

/// Draft, edit, validate and sign one note. Signed notes are read-only; later changes are dated addenda.
struct NoteDetailView: View {
    @Environment(\.modelContext) private var context
    @Environment(Preferences.self) private var preferences
    @Bindable var session: SessionRecord
    let sameDay: [SessionRecord]
    @State private var draft = ""
    @State private var format: NoteFormat = .soap
    @State private var addendumText = ""
    @State private var showingAddendum = false
    @State private var showingCapture = false
    @State private var authFailed = false
    private let time = TimeStyle()

    private var issues: [AuditIssue] {
        SelfAudit.check(session.snapshot, sameDay: sameDay.map(\.snapshot))
    }

    private var composed: ComposedNote {
        NoteComposer(timeStyle: time).compose(session.snapshot, format: format)
    }

    var body: some View {
        Form {
            Section {
                LabeledContent("Student", value: session.studentCode)
                LabeledContent("Date", value: time.date(session.date))
                if let start = session.start {
                    LabeledContent("Time", value: "\(time.time(start)) – \(session.end.map(time.time) ?? "…")")
                }
                LabeledContent("Service type", value: session.snapshot.serviceType)
            }

            if session.isSigned {
                signedSection
            } else {
                if !issues.isEmpty || !composed.missing.isEmpty {
                    Section("Check before signing") {
                        ForEach(issues, id: \.self) { issue in
                            Label(issue.message, systemImage: issue.severity == .blocking ? "exclamationmark.circle.fill" : "info.circle")
                                .foregroundStyle(issue.severity == .blocking ? Theme.warning : .secondary)
                        }
                        ForEach(composed.missing.filter { m in !issues.contains { $0.message.localizedCaseInsensitiveContains(m) } }, id: \.self) { m in
                            Label("Not recorded: \(m.lowercased())", systemImage: "info.circle").foregroundStyle(.secondary)
                        }
                        Button("Fix in session") { showingCapture = true }
                    }
                }
                Section {
                    Picker("Format", selection: $format) {
                        ForEach(NoteFormat.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    TextEditor(text: $draft)
                        .frame(minHeight: 260)
                        .font(.body)
                    Button("Regenerate from session data") {
                        draft = composed.plainText
                    }
                } header: {
                    Text("Note")
                } footer: {
                    Text("Bracketed text is a placeholder for you to fill in or delete.")
                }
                Section {
                    Button {
                        Task { await sign() }
                    } label: {
                        Label("Sign and lock", systemImage: "signature").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!SelfAudit.isReadyToSign(issues) || session.isInProgress)
                } footer: {
                    Text("Signs as \(preferences.signature). After signing, the note can't be edited; add a dated addendum instead.")
                }
            }
        }
        .navigationTitle(session.studentCode)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            format = NoteFormat(rawValue: session.noteFormatRaw ?? "") ?? preferences.noteFormat
            draft = session.noteText ?? composed.plainText
        }
        .onDisappear {
            if !session.isSigned { session.noteText = draft; session.noteFormatRaw = format.rawValue; try? context.save() }
        }
        .onChange(of: format) { _, _ in
            if !session.isSigned { draft = composed.plainText }
        }
        .sheet(isPresented: $showingCapture) {
            NavigationStack { SessionCaptureView(groupKey: session.groupKey) }
                .onDisappear { draft = composed.plainText }
        }
        .sheet(isPresented: $showingAddendum) { addendumSheet }
        .alert("Couldn't confirm it's you", isPresented: $authFailed) {
            Button("OK", role: .cancel) {}
        }
    }

    @ViewBuilder private var signedSection: some View {
        Section {
            Text(session.noteText ?? "")
                .textSelection(.enabled)
        } header: {
            Text("Signed note")
        } footer: {
            if let at = session.signedAt {
                Text("Signed \(time.date(at)) \(time.time(at)) by \(session.signerName ?? "—"). Locked.")
            }
        }
        if !session.addenda.isEmpty {
            Section("Addenda") {
                ForEach(session.addenda, id: \.self) { a in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(time.date(a.date)) \(time.time(a.date)) · \(a.author)").font(.footnote).foregroundStyle(.secondary)
                        Text(a.text)
                    }
                }
            }
        }
        Section {
            Button("Add addendum") { showingAddendum = true }
        }
    }

    private var addendumSheet: some View {
        NavigationStack {
            Form {
                TextEditor(text: $addendumText).frame(minHeight: 180)
            }
            .navigationTitle("Addendum")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showingAddendum = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        let text = addendumText.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !text.isEmpty else { return }
                        let scrubbed = NameScrubber.scrub(text, names: IdentityVault.namesForScrubbing()).text
                        session.addenda = session.addenda + [Addendum(date: .now, author: preferences.signature, text: scrubbed)]
                        context.audit("Note", session.id.uuidString, "addendum added", session.studentCode)
                        try? context.save()
                        addendumText = ""
                        showingAddendum = false
                    }
                }
            }
        }
    }

    private func sign() async {
        guard await Authenticator.authenticate(reason: "Sign this note") else {
            authFailed = true
            return
        }
        let names = IdentityVault.namesForScrubbing()
        let text = names.isEmpty ? draft : NameScrubber.scrub(draft, names: names).text
        NoteSigner.sign(session, text: text, format: format, signer: preferences.signature, context: context)
        try? context.save()
    }
}
