import SwiftUI
import SwiftData
import Charts
import TapNoteCore

/// Per-student progress report for a month, quarter, year or custom range: a chart per goal,
/// an editable draft built only from recorded sessions, and a PDF export with the real name added on device.
struct ReportsView: View {
    @Environment(Preferences.self) private var preferences
    @Query(filter: #Predicate<StudentRecord> { $0.isActive }, sort: \StudentRecord.code) private var students: [StudentRecord]
    @State private var studentCode: String?
    @State private var period: ReportPeriod = .quarter
    @State private var endDate = Date.now
    @State private var customStart = Calendar.current.date(byAdding: .month, value: -3, to: .now) ?? .now
    @State private var draft = ""
    @State private var shared: SharedFile?
    @State private var errorText: String?
    private let time = TimeStyle()

    private var student: StudentRecord? {
        students.first { $0.code == studentCode } ?? students.first
    }

    private var range: ClosedRange<Date> {
        if period == .custom {
            let start = Calendar.current.startOfDay(for: min(customStart, endDate))
            let end = Calendar.current.date(bySettingHour: 23, minute: 59, second: 59, of: endDate) ?? endDate
            return start...end
        }
        return period.range(endingAt: endDate)
    }

    private var periodLabel: String {
        switch period {
        case .month: return "month"
        case .quarter: return "quarter"
        case .year: return "year"
        case .custom: return "period"
        }
    }

    private var progress: [GoalProgress] {
        guard let student else { return [] }
        let snaps = student.sessions.map(\.snapshot)
        let composer = ProgressReportComposer(timeStyle: time)
        return student.goalSnapshots.map { composer.progress(for: $0, sessions: snaps, in: range, periodLabel: periodLabel) }
    }

    private var attendanceLine: String {
        guard let student else { return "" }
        let inRange = student.sessions.filter { range.contains($0.date) }
        let delivered = inRange.filter { $0.attendance.serviceDelivered }
        let minutes = delivered.compactMap { $0.snapshot.minutes }.reduce(0, +)
        let missed = inRange.count - delivered.count
        return "Sessions held: \(delivered.count) (\(minutes) min). Sessions missed: \(missed)."
    }

    private var generated: String {
        ([attendanceLine] + progress.map { "Goal \($0.goal.number) · \($0.goal.shortName) — \($0.status.rawValue)\n\($0.narrative)" })
            .joined(separator: "\n\n")
    }

    var body: some View {
        NavigationStack {
            Form {
                if students.isEmpty {
                    ContentUnavailableView("No students yet", systemImage: "person.2", description: Text("Add students and goals on the Students tab."))
                } else {
                    Section {
                        Picker("Student", selection: Binding(get: { student?.code ?? "" }, set: { studentCode = $0 })) {
                            ForEach(students) { Text("\($0.code) · \($0.alias)").tag($0.code) }
                        }
                        Picker("Period", selection: $period) {
                            ForEach(ReportPeriod.allCases) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        if period == .custom {
                            DatePicker("From", selection: $customStart, displayedComponents: [.date])
                        }
                        DatePicker(period == .custom ? "To" : "Ending", selection: $endDate, displayedComponents: [.date])
                    } footer: {
                        Text("\(time.date(range.lowerBound)) – \(time.date(range.upperBound))")
                    }

                    ForEach(progress, id: \.goal.id) { p in
                        Section("Goal \(p.goal.number) · \(p.goal.shortName)") {
                            GoalChart(progress: p)
                            HStack {
                                StatusBadge(text: p.status.rawValue, kind: p.status == .met || p.status == .progressing ? .ok : p.status == .insufficientData ? .neutral : .warning)
                                if let avg = p.average { Text("Average \(avg)%").font(.subheadline).foregroundStyle(.secondary) }
                            }
                        }
                    }

                    Section {
                        TextEditor(text: $draft).frame(minHeight: 260)
                        Button("Regenerate draft from data") { draft = generated }
                    } header: {
                        Text("Report text")
                    } footer: {
                        Text("Built only from recorded sessions. Bracketed text is a placeholder for your observations.")
                    }

                    Section {
                        Button {
                            Task { await exportPDF() }
                        } label: {
                            Label("Export PDF with student name", systemImage: "square.and.arrow.up")
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                    } footer: {
                        Text("The real name is added on this phone at export, after Face ID.")
                    }
                }
            }
            .navigationTitle("Progress report")
            .onAppear { if draft.isEmpty { draft = generated } }
            .onChange(of: studentCode) { _, _ in draft = generated }
            .onChange(of: period) { _, _ in draft = generated }
            .onChange(of: endDate) { _, _ in draft = generated }
            .onChange(of: customStart) { _, _ in draft = generated }
            .sheet(item: $shared) { file in ShareSheet(items: [file.url]) }
            .alert("Export", isPresented: Binding(get: { errorText != nil }, set: { if !$0 { errorText = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(errorText ?? "") }
        }
    }

    private func exportPDF() async {
        guard let student else { return }
        guard await Authenticator.authenticate(reason: "Add the student's name to the report") else {
            errorText = "Face ID or passcode is needed to add the student's name."
            return
        }
        let identity = IdentityVault.identity(for: student.code)
        var header: [String] = []
        if let identity {
            header.append("Student: \(identity.realName)" + (identity.dateOfBirth.isEmpty ? "" : " · DOB \(identity.dateOfBirth)"))
            if !identity.paSecureID.isEmpty { header.append("PA Secure ID: \(identity.paSecureID)") }
        } else {
            header.append("Student: \(student.code) (no name in vault)")
        }
        header.append("Period: \(time.date(range.lowerBound)) – \(time.date(range.upperBound))")
        header.append("Therapist: \(preferences.signature)")
        let blocks = draft.components(separatedBy: "\n\n").map { PDFRenderer.Block(heading: nil, text: $0) }
        let data = PDFRenderer.render(title: "Occupational Therapy Progress Report", headerLines: header, blocks: blocks, footer: "Prepared \(time.date(.now))")
        do {
            let url = try AppStore.writeExport(data, named: "OT-Progress-\(student.code)-\(Self.fileDate(range.upperBound)).pdf")
            shared = SharedFile(url: url)
        } catch {
            errorText = error.localizedDescription
        }
    }

    static func fileDate(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}

private struct GoalChart: View {
    let progress: GoalProgress

    var body: some View {
        if progress.points.isEmpty {
            Text("No data in this period.").foregroundStyle(.secondary)
        } else {
            Chart {
                ForEach(Array(progress.points.enumerated()), id: \.offset) { index, point in
                    BarMark(x: .value("Session", index + 1), y: .value("% correct", point.percent))
                        .foregroundStyle(Theme.accent)
                }
                if let crit = progress.goal.criterionPercent {
                    RuleMark(y: .value("Criterion", crit))
                        .foregroundStyle(Theme.warning)
                        .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
                        .annotation(position: .top, alignment: .leading) {
                            Text("\(crit)% criterion").font(.caption).foregroundStyle(Theme.warning)
                        }
                }
            }
            .chartYScale(domain: 0...100)
            .chartXAxisLabel("Session")
            .chartYAxisLabel("% correct")
            .frame(height: 160)
            .accessibilityLabel("Percent correct by session: " + progress.points.map { "\($0.percent)" }.joined(separator: ", "))
        }
    }
}
