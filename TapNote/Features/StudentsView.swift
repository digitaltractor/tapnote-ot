import SwiftUI
import SwiftData
import TapNoteCore

struct StudentsView: View {
    @Query(sort: \StudentRecord.code) private var students: [StudentRecord]
    @State private var revealed: [String: StudentIdentity] = [:]
    @State private var showingNew = false
    @State private var authFailed = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        if revealed.isEmpty { Task { await reveal() } } else { revealed = [:] }
                    } label: {
                        Label(revealed.isEmpty ? "Show real names (Face ID)" : "Hide real names", systemImage: revealed.isEmpty ? "lock" : "lock.open")
                            .frame(minHeight: 44)
                    }
                } footer: {
                    Text("Students appear by code and alias everywhere. Real names, birth dates and IDs stay in this phone's Keychain and are added only to files you export.")
                }

                Section("Students") {
                    if students.isEmpty {
                        Text("No students yet. Tap + to add one.").foregroundStyle(.secondary)
                    }
                    ForEach(students) { student in
                        NavigationLink {
                            StudentEditor(student: student)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(student.code).font(.body.monospaced())
                                    Text(student.alias).foregroundStyle(.secondary)
                                    if !student.isActive { StatusBadge(text: "Inactive", kind: .neutral) }
                                }
                                Text(summary(student)).font(.subheadline).foregroundStyle(.secondary)
                                if let identity = revealed[student.code] {
                                    Text("\(identity.realName)\(identity.dateOfBirth.isEmpty ? "" : " · \(identity.dateOfBirth)")")
                                        .font(.subheadline)
                                        .padding(.horizontal, 8).padding(.vertical, 4)
                                        .background(RoundedRectangle(cornerRadius: 6).fill(Theme.accentTint))
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            }
            .navigationTitle("Students")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingNew = true } label: { Label("Add student", systemImage: "plus") }
                }
            }
            .sheet(isPresented: $showingNew) {
                NavigationStack { StudentEditor(student: nil) }
            }
            .alert("Couldn't confirm it's you", isPresented: $authFailed) { Button("OK", role: .cancel) {} }
            .onDisappear { revealed = [:] }
        }
    }

    private func summary(_ s: StudentRecord) -> String {
        var parts: [String] = []
        if !s.gradeBand.isEmpty { parts.append("Grade \(s.gradeBand)") }
        parts.append("\(s.activeGoals.count) goal\(s.activeGoals.count == 1 ? "" : "s")")
        parts.append("\(s.weeklyMinutes) min/week \(s.serviceMode)")
        return parts.joined(separator: " · ")
    }

    private func reveal() async {
        if await Authenticator.authenticate(reason: "Show students' real names") {
            revealed = IdentityVault.all()
        } else {
            authFailed = true
        }
    }
}

/// Create or edit a student, their IEP goals, and (behind Face ID) their real identity.
struct StudentEditor: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    let student: StudentRecord?

    @Query private var allStudents: [StudentRecord]
    @State private var code = ""
    @State private var alias = ""
    @State private var gradeBand = ""
    @State private var serviceMode = "individual"
    @State private var weeklyMinutes = 30
    @State private var reportCadence = "Quarterly"
    @State private var isActive = true
    @State private var goals: [GoalDraft] = []
    @State private var identity = StudentIdentity(realName: "")
    @State private var identityUnlocked = false
    @State private var loaded = false
    @State private var errorText: String?

    struct GoalDraft: Identifiable {
        var id = UUID()
        var record: GoalRecord?
        var shortName = ""
        var detail = ""
        var criterion = 80
        var isActive = true
    }

    private var isNew: Bool { student == nil }

    var body: some View {
        Form {
            Section {
                HStack {
                    Text("Code")
                    Spacer()
                    Text(code).font(.body.monospaced())
                    if isNew {
                        Button { newCode() } label: { Image(systemName: "arrow.clockwise") }
                            .accessibilityLabel("New code")
                    }
                }
                TextField("Alias (shown in lists)", text: $alias)
                TextField("Grade band (e.g. 1–2)", text: $gradeBand)
                Picker("Service", selection: $serviceMode) {
                    Text("Individual").tag("individual")
                    Text("Group").tag("group")
                }
                Stepper("\(weeklyMinutes) min per week", value: $weeklyMinutes, in: 0...600, step: 15)
                Picker("Progress reports", selection: $reportCadence) {
                    ForEach(["Monthly", "Quarterly", "With report cards", "Annually"], id: \.self) { Text($0) }
                }
                if !isNew { Toggle("Active", isOn: $isActive) }
            } header: {
                Text("Student")
            } footer: {
                Text("Pick an alias that isn't the child's name or initials.")
            }

            Section {
                ForEach($goals) { $goal in
                    VStack(alignment: .leading, spacing: 6) {
                        TextField("Goal name (e.g. Letter formation)", text: $goal.shortName)
                            .font(.headline)
                        TextField("Goal text from the IEP (optional)", text: $goal.detail, axis: .vertical)
                            .lineLimit(1...4)
                        Stepper("Criterion \(goal.criterion)%", value: $goal.criterion, in: 10...100, step: 5)
                        if goal.record != nil { Toggle("Active", isOn: $goal.isActive) }
                    }
                    .padding(.vertical, 4)
                }
                .onDelete { offsets in
                    let removable = IndexSet(offsets.filter { goals[$0].record == nil })
                    goals.remove(atOffsets: removable)
                }
                Button { goals.append(GoalDraft()) } label: { Label("Add goal", systemImage: "plus") }
            } header: {
                Text("IEP goals")
            } footer: {
                Text("Goals with recorded sessions can be made inactive but not deleted.")
            }

            Section {
                if isNew || identityUnlocked {
                    TextField("Real name", text: $identity.realName)
                        .textContentType(.name)
                    TextField("Date of birth (MM/DD/YYYY)", text: $identity.dateOfBirth)
                    TextField("PA Secure ID", text: $identity.paSecureID)
                        .keyboardType(.numberPad)
                    TextField("Diagnosis / condition (for SBAP logs)", text: $identity.diagnosis)
                } else {
                    Button { Task { await unlockIdentity() } } label: {
                        Label("Unlock identity (Face ID)", systemImage: "lock")
                    }
                }
            } header: {
                Text("Identity vault")
            } footer: {
                Text("Stored only in this phone's Keychain. Never synced, backed up, or sent anywhere.")
            }
        }
        .navigationTitle(isNew ? "New student" : code)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isNew {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }
                    .disabled(alias.trimmingCharacters(in: .whitespaces).isEmpty || code.isEmpty)
            }
        }
        .onAppear(perform: load)
        .alert("Couldn't save", isPresented: Binding(get: { errorText != nil }, set: { if !$0 { errorText = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(errorText ?? "") }
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let s = student {
            code = s.code
            alias = s.alias
            gradeBand = s.gradeBand
            serviceMode = s.serviceMode
            weeklyMinutes = s.weeklyMinutes
            reportCadence = s.reportCadence
            isActive = s.isActive
            goals = s.goals.sorted { $0.number < $1.number }.map {
                GoalDraft(record: $0, shortName: $0.shortName, detail: $0.detail, criterion: $0.criterionPercent, isActive: $0.isActive)
            }
        } else {
            newCode()
            goals = [GoalDraft()]
        }
    }

    private func newCode() {
        code = PseudonymGenerator.make(excluding: Set(allStudents.map(\.code)))
        alias = PseudonymGenerator.alias(for: code)
    }

    private func unlockIdentity() async {
        guard await Authenticator.authenticate(reason: "Show this student's identity") else { return }
        identity = IdentityVault.identity(for: code) ?? StudentIdentity(realName: "")
        identityUnlocked = true
    }

    private func save() {
        let target: StudentRecord
        if let s = student {
            target = s
        } else {
            target = StudentRecord(code: code, alias: alias)
            context.insert(target)
        }
        target.alias = alias.trimmingCharacters(in: .whitespaces)
        target.gradeBand = gradeBand
        target.serviceMode = serviceMode
        target.weeklyMinutes = weeklyMinutes
        target.reportCadence = reportCadence
        target.isActive = isActive

        var number = (target.goals.map(\.number).max() ?? 0)
        for draft in goals {
            let name = draft.shortName.trimmingCharacters(in: .whitespaces)
            if let record = draft.record {
                record.shortName = name.isEmpty ? record.shortName : name
                record.detail = draft.detail
                record.criterionPercent = draft.criterion
                record.isActive = draft.isActive
            } else if !name.isEmpty {
                number += 1
                let record = GoalRecord(number: number, shortName: name, detail: draft.detail, criterionPercent: draft.criterion)
                record.student = target
                context.insert(record)
            }
        }
        context.audit("Student", target.code, isNew ? "created" : "edited")

        if isNew || identityUnlocked {
            if identity.realName.trimmingCharacters(in: .whitespaces).isEmpty && identity.paSecureID.isEmpty {
                if identityUnlocked { IdentityVault.delete(code: target.code) }
            } else {
                do {
                    try IdentityVault.save(identity, for: target.code)
                } catch {
                    errorText = "The record saved, but the identity couldn't be stored: \(error.localizedDescription)"
                }
            }
        }
        do {
            try context.save()
        } catch {
            errorText = error.localizedDescription
            return
        }
        if errorText == nil { dismiss() }
    }
}
