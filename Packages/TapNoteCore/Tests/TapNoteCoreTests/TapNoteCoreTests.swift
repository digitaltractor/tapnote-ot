import XCTest
@testable import TapNoteCore

final class TapNoteCoreTests: XCTestCase {
    let utc = TimeZone(identifier: "UTC")!
    lazy var style = TimeStyle(timeZone: utc)

    func date(_ iso: String) -> Date {
        let f = ISO8601DateFormatter()
        f.timeZone = utc
        return f.date(from: iso)!
    }

    func otterSession(progress: ProgressIndicator? = .progressing) -> (SessionSnapshot, GoalSnapshot, GoalSnapshot) {
        let g1 = GoalSnapshot(number: 1, shortName: "Letter formation", criterionPercent: 90)
        let g2 = GoalSnapshot(number: 2, shortName: "Cutting a curved line", criterionPercent: 80)
        let s = SessionSnapshot(
            studentCode: "K7-OTTER",
            studentAlias: "Otter",
            date: date("2026-10-07T09:15:00Z"),
            start: date("2026-10-07T09:15:00Z"),
            end: date("2026-10-07T09:45:40Z"),
            activities: [Activity.starterCatalog[0], Activity.starterCatalog[2]],
            goals: [g1, g2],
            observations: [
                GoalObservation(goalID: g1.id, correct: 7, total: 10, promptLevelName: "Verbal"),
                GoalObservation(goalID: g2.id, correct: 3, total: 6, promptLevelName: "Partial physical")
            ],
            regulation: .calm,
            engagement: 4,
            progress: progress,
            comment: "used slant board"
        )
        return (s, g1, g2)
    }

    // MARK: Service type and minutes

    func testServiceTypeCodes() {
        XCTAssertEqual(sbapServiceType(attendance: .present, delivery: .inPerson, isMakeUp: false), "D")
        XCTAssertEqual(sbapServiceType(attendance: .present, delivery: .inPerson, isMakeUp: true), "DM")
        XCTAssertEqual(sbapServiceType(attendance: .present, delivery: .telehealthHome, isMakeUp: false), "10")
        XCTAssertEqual(sbapServiceType(attendance: .present, delivery: .telehealthNotHome, isMakeUp: true), "02M")
        XCTAssertEqual(sbapServiceType(attendance: .studentAbsent, delivery: .inPerson, isMakeUp: false), "SA")
        XCTAssertEqual(sbapServiceType(attendance: .providerNotAvailable, delivery: .inPerson, isMakeUp: false), "PNA")
    }

    func testMinutesAreNeverRoundedUp() {
        let (s, _, _) = otterSession()
        XCTAssertEqual(s.minutes, 30) // 30 min 40 s -> 30
    }

    // MARK: Notes

    func testSOAPNoteUsesOnlyRecordedFacts() {
        let (s, _, _) = otterSession()
        let note = NoteComposer(timeStyle: style).compose(s, format: .soap)
        XCTAssertEqual(note.sections.map(\.title), ["S", "O", "A", "P"])
        XCTAssertEqual(note.sections[0].text, "Presented calm on arrival. Engagement 4/5.")
        XCTAssertTrue(note.sections[1].text.contains("9:15 AM–9:45 AM (30 min)"))
        XCTAssertTrue(note.sections[1].text.contains("Goal 1 (Letter formation): 7/10 trials correct (70%) with verbal prompts."))
        XCTAssertTrue(note.sections[1].text.contains("Therapist comment: used slant board"))
        XCTAssertTrue(note.sections[2].text.contains("Goal 1 accuracy (70%) is below the 90% criterion."))
        XCTAssertTrue(note.missing.isEmpty)
    }

    func testMissingDataIsFlaggedNotInvented() {
        var (s, _, _) = otterSession(progress: nil)
        s.regulation = nil
        let note = NoteComposer(timeStyle: style).compose(s, format: .soap)
        XCTAssertEqual(note.missing, ["Regulation state", "Progress indicator"])
        XCTAssertFalse(note.plainText.lowercased().contains("progressing"))
    }

    func testAbsentSessionIsLogOnly() {
        var (s, _, _) = otterSession()
        s.attendance = .studentAbsent
        let note = NoteComposer(timeStyle: style).compose(s, format: .soap)
        XCTAssertEqual(note.sections.count, 1)
        XCTAssertTrue(note.plainText.hasPrefix("Student absent (SA)."))
    }

    func testNarrativeAndDAPFormats() {
        let (s, _, _) = otterSession()
        let composer = NoteComposer(timeStyle: style)
        XCTAssertEqual(composer.compose(s, format: .narrative).sections.count, 1)
        XCTAssertEqual(composer.compose(s, format: .dap).sections.map(\.title), ["D", "A", "P"])
    }

    // MARK: Self-audit

    func testReadySessionPassesAudit() {
        let (s, _, _) = otterSession()
        XCTAssertTrue(SelfAudit.isReadyToSign(SelfAudit.check(s)))
    }

    func testMissingProgressBlocksSigning() {
        let (s, _, _) = otterSession(progress: nil)
        let issues = SelfAudit.check(s)
        XCTAssertFalse(SelfAudit.isReadyToSign(issues))
        XCTAssertTrue(issues.contains(AuditIssue(.blocking, "Choose a progress indicator")))
    }

    func testOverlappingSessionsBlockSigning() {
        let (s, _, _) = otterSession()
        let other = SessionSnapshot(studentCode: "M3-HERON", date: s.date, start: date("2026-10-07T09:30:00Z"), end: date("2026-10-07T10:00:00Z"), progress: .maintaining)
        let issues = SelfAudit.check(s, sameDay: [other])
        XCTAssertTrue(issues.contains(AuditIssue(.blocking, "Overlaps the M3-HERON session")))
    }

    func testSameGroupSessionsDoNotCountAsOverlap() {
        let start = date("2026-10-07T08:30:00Z"), end = date("2026-10-07T09:00:00Z")
        let a = SessionSnapshot(studentCode: "R2-FINCH", date: start, start: start, end: end, groupSize: 3, activities: [Activity.starterCatalog[0]], progress: .progressing)
        let b = SessionSnapshot(studentCode: "T5-CEDAR", date: start, start: start, end: end, groupSize: 3, activities: [Activity.starterCatalog[0]], progress: .progressing)
        XCTAssertTrue(SelfAudit.isReadyToSign(SelfAudit.check(a, sameDay: [a, b])))
    }

    func testAbsentSessionNeedsNoTimes() {
        let s = SessionSnapshot(studentCode: "M3-HERON", date: date("2026-10-07T10:00:00Z"), attendance: .studentAbsent)
        XCTAssertTrue(SelfAudit.check(s).isEmpty)
    }

    // MARK: CSV export

    func testCSVPseudonymousByDefault() {
        let (s, _, _) = otterSession()
        let csv = SBAPExport(timeStyle: style).csv(sessions: [s])
        let lines = csv.components(separatedBy: "\r\n")
        XCTAssertEqual(lines[0], "Student Code,Date,Start,End,Treatment Key,Group Size,Service Type,Progress Indicator,Description")
        XCTAssertTrue(lines[1].hasPrefix("K7-OTTER,10/07/2026,9:15 AM,9:45 AM,19; 51,1,D,Pr,"))
    }

    func testCSVAddsIdentityOnlyWhenProvided() {
        let (s, _, _) = otterSession()
        let csv = SBAPExport(timeStyle: style).csv(sessions: [s], identity: { _ in StudentIdentity(realName: "Test Student", dateOfBirth: "01/02/2018", paSecureID: "1234567890") })
        XCTAssertTrue(csv.contains("Test Student,01/02/2018,1234567890,K7-OTTER"))
    }

    func testCSVEscaping() {
        XCTAssertEqual(SBAPExport.escape("a,b"), "\"a,b\"")
        XCTAssertEqual(SBAPExport.escape("say \"hi\""), "\"say \"\"hi\"\"\"")
        XCTAssertEqual(SBAPExport.escape("=SUM(A1)"), "'=SUM(A1)")
    }

    // MARK: Progress reports

    func testProgressReportFromSessions() {
        let goal = GoalSnapshot(number: 1, shortName: "Letter formation", criterionPercent: 90)
        let values = [40, 50, 55, 70]
        let sessions = values.enumerated().map { i, v in
            SessionSnapshot(studentCode: "K7-OTTER", date: date("2026-09-0\(i + 1)T09:00:00Z"), observations: [GoalObservation(goalID: goal.id, correct: v, total: 100, promptLevelName: i < 2 ? "Partial physical" : "Verbal")])
        }
        let range = date("2026-09-01T00:00:00Z")...date("2026-09-30T23:59:59Z")
        let report = ProgressReportComposer(timeStyle: style).progress(for: goal, sessions: sessions, in: range, periodLabel: "month")
        XCTAssertEqual(report.status, .progressing)
        XCTAssertEqual(report.first, 40)
        XCTAssertEqual(report.last, 70)
        XCTAssertEqual(report.average, 54)
        XCTAssertTrue(report.narrative.contains("went from 40% to 70% (average 54%) against a 90% criterion."))
        XCTAssertTrue(report.narrative.contains("Prompting changed from partial physical to verbal."))
    }

    func testProgressReportWithNoData() {
        let goal = GoalSnapshot(number: 2, shortName: "Buttoning")
        let range = date("2026-09-01T00:00:00Z")...date("2026-09-30T23:59:59Z")
        let report = ProgressReportComposer(timeStyle: style).progress(for: goal, sessions: [], in: range, periodLabel: "month")
        XCTAssertEqual(report.status, .insufficientData)
    }

    // MARK: Pseudonyms

    func testPseudonymFormatAndUniqueness() {
        var existing: Set<String> = []
        for _ in 0..<200 {
            let code = PseudonymGenerator.make(excluding: existing)
            XCTAssertNotNil(code.range(of: "^[A-HJ-NP-Z][2-9]-[A-Z]+$", options: .regularExpression), "unexpected code \(code)")
            XCTAssertFalse(existing.contains(code))
            existing.insert(code)
        }
        XCTAssertEqual(PseudonymGenerator.alias(for: "K7-OTTER"), "Otter")
    }

    func testNameScrubberReplacesFullFirstAndLastNames() {
        let names = ["K7-OTTER": "Ava Martinez", "M3-HERON": "Noah Li"]
        let result = NameScrubber.scrub("Ava did well; Martinez's mom came. noah was out. Avalanche drill.", names: names)
        XCTAssertEqual(result.text, "K7-OTTER did well; K7-OTTER's mom came. M3-HERON was out. Avalanche drill.")
        XCTAssertEqual(result.replacements, 3)
    }

    func testNameScrubberPrefersFullName() {
        let result = NameScrubber.scrub("Ava Martinez arrived", names: ["K7-OTTER": "Ava Martinez"])
        XCTAssertEqual(result.text, "K7-OTTER arrived")
        XCTAssertEqual(result.replacements, 1)
    }
}
