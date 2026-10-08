import SwiftUI
import SwiftData
import UniformTypeIdentifiers
import TapNoteCore

struct SettingsView: View {
    @Environment(\.modelContext) private var context
    @Environment(Preferences.self) private var preferences
    @Query(sort: \SessionRecord.date) private var sessions: [SessionRecord]
    @Query private var students: [StudentRecord]

    @State private var exportFrom = Calendar.current.date(byAdding: .day, value: -7, to: .now) ?? .now
    @State private var exportTo = Date.now
    @State private var includeNames = false
    @State private var passphrase = ""
    @State private var passphraseConfirm = ""
    @State private var showingImporter = false
    @State private var importURL: URL?
    @State private var importPassphrase = ""
    @State private var newActivity = ""
    @State private var newActivityKey = ""
    @State private var shared: SharedFile?
    @State private var message: String?
    private let time = TimeStyle()

    var body: some View {
        @Bindable var prefs = preferences
        NavigationStack {
            Form {
                Section("Therapist") {
                    TextField("Your name", text: $prefs.therapistName)
                        .textContentType(.name)
                    TextField("Credentials", text: $prefs.credentials)
                    Stepper("Default session \(prefs.defaultSessionMinutes) min", value: $prefs.defaultSessionMinutes, in: 5...120, step: 5)
                }

                Section("Notes") {
                    Picker("Note format", selection: $prefs.noteFormat) {
                        ForEach(NoteFormat.allCases) { Text($0.label).tag($0) }
                    }
                }

                Section {
                    ForEach($prefs.promptLevels) { $level in
                        HStack {
                            Toggle(isOn: $level.isEnabled) {
                                TextField("Name", text: $level.name)
                            }
                        }
                    }
                    .onMove { prefs.promptLevels.move(fromOffsets: $0, toOffset: $1); renumberPrompts() }
                    Button("Restore default levels") { prefs.promptLevels = PromptLevel.defaults }
                } header: {
                    Text("Prompt levels")
                } footer: {
                    Text("Least to most assistance. Turn off levels you don't use; drag to reorder in Edit mode.")
                }

                Section {
                    ForEach(prefs.activityCatalog) { activity in
                        HStack {
                            Text(activity.name)
                            Spacer()
                            if let key = activity.sbapKey { Text("SBAP \(key)").font(.footnote.monospaced()).foregroundStyle(.secondary) }
                        }
                    }
                    .onDelete { prefs.activityCatalog.remove(atOffsets: $0) }
                    .onMove { prefs.activityCatalog.move(fromOffsets: $0, toOffset: $1) }
                    HStack {
                        TextField("New activity", text: $newActivity)
                        TextField("SBAP key", text: $newActivityKey)
                            .keyboardType(.numberPad)
                            .frame(width: 80)
                        Button("Add") { addActivity() }
                            .disabled(newActivity.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                } header: {
                    Text("Activities")
                } footer: {
                    Text("Add the numbered treatment keys from the PA SBAP OT Service Provider Log so exported logs carry them.")
                }

                Section {
                    DatePicker("From", selection: $exportFrom, displayedComponents: [.date])
                    DatePicker("To", selection: $exportTo, displayedComponents: [.date])
                    Toggle("Include names, DOB and PA Secure ID", isOn: $includeNames)
                    Button("Export SBAP-format log (CSV)") { Task { await exportCSV() } }
                    Button("Export signed notes (PDF)") { Task { await exportNotesPDF() } }
                } header: {
                    Text("Export")
                } footer: {
                    Text("Without names, files carry student codes only. With names, Face ID is required and identities are added on this phone.")
                }

                Section {
                    SecureField("Backup passphrase", text: $passphrase)
                    SecureField("Repeat passphrase", text: $passphraseConfirm)
                    Button("Export encrypted backup") { exportBackup() }
                        .disabled(passphrase.count < 8 || passphrase != passphraseConfirm)
                    Button("Restore from backup…") { showingImporter = true }
                    Button("Export name key (Face ID)") { Task { await exportNameKey() } }
                } header: {
                    Text("Backup")
                } footer: {
                    Text("The backup holds codes and session data, encrypted with your passphrase (8+ characters). Names are not in it: export the name key separately and keep it somewhere safe, like a district drive.")
                }

                Section("About") {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                    Button("Load sample students") { loadSamples() }
                        .disabled(!students.isEmpty)
                }
            }
            .navigationTitle("Settings")
            .toolbar { EditButton() }
            .sheet(item: $shared) { file in ShareSheet(items: [file.url]) }
            .fileImporter(isPresented: $showingImporter, allowedContentTypes: [.data]) { result in
                if case .success(let url) = result { importURL = url }
            }
            .alert("Restore backup", isPresented: Binding(get: { importURL != nil }, set: { if !$0 { importURL = nil } })) {
                SecureField("Passphrase", text: $importPassphrase)
                Button("Replace all data", role: .destructive) { restoreBackup() }
                Button("Cancel", role: .cancel) { importURL = nil }
            } message: {
                Text("This replaces every student and session on this phone with the backup's contents.")
            }
            .alert("TapNote", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(message ?? "") }
        }
    }

    // MARK: Actions

    private var rangeSessions: [SessionRecord] {
        let start = Calendar.current.startOfDay(for: exportFrom)
        let end = Calendar.current.date(bySettingHour: 23, minute: 59, second: 59, of: exportTo) ?? exportTo
        return sessions.filter { $0.date >= start && $0.date <= end }
    }

    private func stamp() -> String { ReportsView.fileDate(.now) }

    private func renumberPrompts() {
        for i in preferences.promptLevels.indices { preferences.promptLevels[i].rank = i }
    }

    private func addActivity() {
        let name = newActivity.trimmingCharacters(in: .whitespaces)
        let key = Int(newActivityKey.trimmingCharacters(in: .whitespaces))
        preferences.activityCatalog.append(Activity(id: "custom-\(UUID().uuidString.prefix(8))", name: name, sbapKey: key))
        newActivity = ""
        newActivityKey = ""
    }

    private func identities(required: Bool) async -> [String: StudentIdentity]? {
        guard required else { return [:] }
        guard await Authenticator.authenticate(reason: "Add names to the export") else {
            message = "Face ID or passcode is needed to export names."
            return nil
        }
        return IdentityVault.all()
    }

    private func exportCSV() async {
        guard let ids = await identities(required: includeNames) else { return }
        let rows = rangeSessions
        var lookup: ((String) -> StudentIdentity?)? = nil
        if includeNames { lookup = { code in ids[code] } }
        let csv = SBAPExport(timeStyle: time).csv(
            sessions: rows.map(\.snapshot),
            noteText: { snap in rows.first(where: { $0.id == snap.id })?.noteText },
            identity: lookup
        )
        share(Data(csv.utf8), "SBAP-log-\(stamp())\(includeNames ? "-identified" : "").csv")
    }

    private func exportNotesPDF() async {
        guard let ids = await identities(required: includeNames) else { return }
        let signed = rangeSessions.filter(\.isSigned)
        guard !signed.isEmpty else { message = "No signed notes in this date range."; return }
        let blocks: [PDFRenderer.Block] = signed.map { s in
            let who = includeNames ? (ids[s.studentCode]?.realName ?? s.studentCode) : s.studentCode
            var heading = "\(who) · \(time.date(s.date))"
            if let start = s.start, let end = s.end { heading += " · \(time.time(start))–\(time.time(end))" }
            heading += " · \(s.snapshot.serviceType)"
            var text = s.noteText ?? ""
            if let at = s.signedAt { text += "\nSigned \(time.date(at)) \(time.time(at)) by \(s.signerName ?? "")" }
            for a in s.addenda { text += "\nAddendum \(time.date(a.date)) \(time.time(a.date)) (\(a.author)): \(a.text)" }
            return PDFRenderer.Block(heading: heading, text: text)
        }
        let data = PDFRenderer.render(
            title: "Occupational Therapy Session Notes",
            headerLines: ["\(time.date(exportFrom)) – \(time.date(exportTo))", "Therapist: \(preferences.signature)"],
            blocks: blocks,
            footer: "Exported \(time.date(.now))"
        )
        share(data, "OT-notes-\(stamp())\(includeNames ? "-identified" : "").pdf")
    }

    private func exportBackup() {
        do {
            let data = try BackupService.export(context: context, passphrase: passphrase)
            passphrase = ""
            passphraseConfirm = ""
            share(data, "TapNote-\(stamp()).tapnotebackup")
        } catch {
            message = error.localizedDescription
        }
    }

    private func restoreBackup() {
        guard let url = importURL else { return }
        importURL = nil
        let didAccess = url.startAccessingSecurityScopedResource()
        defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            try BackupService.restore(data, passphrase: importPassphrase, into: context)
            message = "Backup restored."
        } catch {
            message = error.localizedDescription
        }
        importPassphrase = ""
    }

    private func exportNameKey() async {
        guard let ids = await identities(required: true) else { return }
        var rows = [["Student Code", "Alias", "Real Name", "DOB", "PA Secure ID", "Diagnosis"]]
        for s in students.sorted(by: { $0.code < $1.code }) {
            let id = ids[s.code]
            rows.append([s.code, s.alias, id?.realName ?? "", id?.dateOfBirth ?? "", id?.paSecureID ?? "", id?.diagnosis ?? ""])
        }
        let csv = rows.map { $0.map { SettingsView.csvField($0) }.joined(separator: ",") }.joined(separator: "\r\n") + "\r\n"
        share(Data(csv.utf8), "TapNote-name-key-\(stamp()).csv")
    }

    static func csvField(_ value: String) -> String {
        var v = value
        if let first = v.first, "=+-@".contains(first) { v = "'" + v }
        if v.contains(where: { $0 == "," || $0 == "\"" || $0 == "\n" }) {
            return "\"" + v.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return v
    }

    private func share(_ data: Data, _ name: String) {
        do {
            shared = SharedFile(url: try AppStore.writeExport(data, named: name))
        } catch {
            message = error.localizedDescription
        }
    }

    private func loadSamples() {
        let samples: [(String, String, String, [(String, Int)])] = [
            ("K7-OTTER", "Otter", "1–2", [("Letter formation", 90), ("Cutting a curved line", 80)]),
            ("M3-HERON", "Heron", "K", [("Buttoning", 80)]),
            ("P9-MAPLE", "Maple", "3–5", [("Copying from board", 85)])
        ]
        for (code, alias, band, goals) in samples {
            let s = StudentRecord(code: code, alias: alias, gradeBand: band, weeklyMinutes: 30)
            context.insert(s)
            for (i, g) in goals.enumerated() {
                let goal = GoalRecord(number: i + 1, shortName: g.0, criterionPercent: g.1)
                goal.student = s
                context.insert(goal)
            }
        }
        context.audit("Student", "samples", "loaded sample students")
        try? context.save()
    }
}
