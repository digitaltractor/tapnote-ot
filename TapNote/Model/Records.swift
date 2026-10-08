import Foundation
import SwiftData
import TapNoteCore

// Persisted records. Only pseudonymous data lives here: student codes and aliases, never names.
// Real identities are in the Keychain (IdentityVault) and are joined in only at export time.

@Model
final class StudentRecord {
    @Attribute(.unique) var code: String
    var alias: String
    var gradeBand: String
    /// "individual" or "group"
    var serviceMode: String
    var weeklyMinutes: Int
    var reportCadence: String
    var isActive: Bool
    var createdAt: Date
    @Relationship(deleteRule: .cascade, inverse: \GoalRecord.student) var goals: [GoalRecord] = []
    @Relationship(deleteRule: .cascade, inverse: \SessionRecord.student) var sessions: [SessionRecord] = []

    init(code: String, alias: String, gradeBand: String = "", serviceMode: String = "individual", weeklyMinutes: Int = 30, reportCadence: String = "Quarterly") {
        self.code = code
        self.alias = alias
        self.gradeBand = gradeBand
        self.serviceMode = serviceMode
        self.weeklyMinutes = weeklyMinutes
        self.reportCadence = reportCadence
        self.isActive = true
        self.createdAt = .now
    }

    var activeGoals: [GoalRecord] {
        goals.filter(\.isActive).sorted { $0.number < $1.number }
    }

    var goalSnapshots: [GoalSnapshot] {
        activeGoals.map { $0.snapshot }
    }
}

@Model
final class GoalRecord {
    var id: UUID
    var number: Int
    var shortName: String
    var detail: String
    var criterionPercent: Int
    var isActive: Bool
    var createdAt: Date
    var student: StudentRecord?

    init(number: Int, shortName: String, detail: String = "", criterionPercent: Int = 80) {
        self.id = UUID()
        self.number = number
        self.shortName = shortName
        self.detail = detail
        self.criterionPercent = criterionPercent
        self.isActive = true
        self.createdAt = .now
    }

    var snapshot: GoalSnapshot {
        GoalSnapshot(id: id, number: number, shortName: shortName, detail: detail, criterionPercent: criterionPercent)
    }
}

struct Addendum: Codable, Hashable {
    var date: Date
    var author: String
    var text: String
}

@Model
final class SessionRecord {
    var id: UUID
    /// Shared by every student in the same group session; unique for an individual session.
    var groupKey: UUID
    var groupSize: Int
    var date: Date
    var start: Date?
    var end: Date?
    var plannedMinutes: Int
    var attendanceRaw: String
    var deliveryRaw: String
    var isMakeUp: Bool
    var activities: [Activity]
    var observations: [GoalObservation]
    var regulationRaw: String?
    var engagement: Int?
    var progressRaw: String?
    var comment: String
    /// Draft text before signing; the locked text after signing.
    var noteText: String?
    var noteFormatRaw: String?
    var signedAt: Date?
    var signerName: String?
    var addenda: [Addendum]
    var student: StudentRecord?

    init(student: StudentRecord, groupKey: UUID, groupSize: Int, start: Date?, plannedMinutes: Int = 30, attendance: Attendance = .present) {
        self.id = UUID()
        self.groupKey = groupKey
        self.groupSize = groupSize
        self.date = start ?? .now
        self.start = start
        self.end = nil
        self.plannedMinutes = plannedMinutes
        self.attendanceRaw = attendance.rawValue
        self.deliveryRaw = Delivery.inPerson.rawValue
        self.isMakeUp = false
        self.activities = []
        self.observations = []
        self.regulationRaw = nil
        self.engagement = nil
        self.progressRaw = nil
        self.comment = ""
        self.noteText = nil
        self.noteFormatRaw = nil
        self.signedAt = nil
        self.signerName = nil
        self.addenda = []
        self.student = student
    }

    var attendance: Attendance {
        get { Attendance(rawValue: attendanceRaw) ?? .present }
        set { attendanceRaw = newValue.rawValue }
    }

    var delivery: Delivery {
        get { Delivery(rawValue: deliveryRaw) ?? .inPerson }
        set { deliveryRaw = newValue.rawValue }
    }

    var regulation: RegulationState? {
        get { regulationRaw.flatMap(RegulationState.init(rawValue:)) }
        set { regulationRaw = newValue?.rawValue }
    }

    var progress: ProgressIndicator? {
        get { progressRaw.flatMap(ProgressIndicator.init(rawValue:)) }
        set { progressRaw = newValue?.rawValue }
    }

    var isSigned: Bool { signedAt != nil }
    var isInProgress: Bool { attendance.serviceDelivered && end == nil }
    var studentCode: String { student?.code ?? "—" }

    func observation(for goalID: UUID) -> GoalObservation {
        observations.first { $0.goalID == goalID } ?? GoalObservation(goalID: goalID)
    }

    func updateObservation(goalID: UUID, _ change: (inout GoalObservation) -> Void) {
        var list = observations
        if let index = list.firstIndex(where: { $0.goalID == goalID }) {
            change(&list[index])
        } else {
            var new = GoalObservation(goalID: goalID)
            change(&new)
            list.append(new)
        }
        observations = list
    }

    func toggle(_ activity: Activity) {
        if activities.contains(where: { $0.id == activity.id }) {
            activities = activities.filter { $0.id != activity.id }
        } else {
            activities = activities + [activity]
        }
    }

    var snapshot: SessionSnapshot {
        SessionSnapshot(
            id: id,
            studentCode: student?.code ?? "",
            studentAlias: student?.alias ?? "",
            date: date,
            start: start,
            end: end,
            plannedMinutes: plannedMinutes,
            groupSize: groupSize,
            attendance: attendance,
            delivery: delivery,
            isMakeUp: isMakeUp,
            activities: activities,
            goals: student?.goalSnapshots ?? [],
            observations: observations,
            regulation: regulation,
            engagement: engagement,
            progress: progress,
            comment: comment,
            signedAt: signedAt
        )
    }
}

/// Append-only audit trail: who changed what and when. Signed notes are never edited in place.
@Model
final class AuditEventRecord {
    var timestamp: Date
    var entity: String
    var entityID: String
    var action: String
    var detail: String

    init(entity: String, entityID: String, action: String, detail: String = "") {
        self.timestamp = .now
        self.entity = entity
        self.entityID = entityID
        self.action = action
        self.detail = detail
    }
}

extension ModelContext {
    func audit(_ entity: String, _ id: String, _ action: String, _ detail: String = "") {
        insert(AuditEventRecord(entity: entity, entityID: id, action: action, detail: detail))
    }
}
