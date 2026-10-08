import Foundation

/// Value-type views of app records. The app maps its persisted models into these so that
/// note drafting, validation and export are pure functions that can be unit-tested anywhere.

public struct GoalSnapshot: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var number: Int
    public var shortName: String
    public var detail: String
    /// Mastery criterion as percent correct, e.g. 90.
    public var criterionPercent: Int?

    public init(id: UUID = UUID(), number: Int, shortName: String, detail: String = "", criterionPercent: Int? = nil) {
        self.id = id
        self.number = number
        self.shortName = shortName
        self.detail = detail
        self.criterionPercent = criterionPercent
    }
}

public struct GoalObservation: Codable, Hashable, Sendable {
    public var goalID: UUID
    public var correct: Int
    public var total: Int
    public var promptLevelName: String?

    public init(goalID: UUID, correct: Int = 0, total: Int = 0, promptLevelName: String? = nil) {
        self.goalID = goalID
        self.correct = correct
        self.total = total
        self.promptLevelName = promptLevelName
    }

    public var percent: Int? {
        guard total > 0 else { return nil }
        return Int((Double(correct) * 100.0 / Double(total)).rounded())
    }
}

public struct SessionSnapshot: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var studentCode: String
    public var studentAlias: String
    public var date: Date
    public var start: Date?
    public var end: Date?
    public var plannedMinutes: Int
    public var groupSize: Int
    public var attendance: Attendance
    public var delivery: Delivery
    public var isMakeUp: Bool
    public var activities: [Activity]
    public var goals: [GoalSnapshot]
    public var observations: [GoalObservation]
    public var regulation: RegulationState?
    public var engagement: Int?
    public var progress: ProgressIndicator?
    public var comment: String
    public var signedAt: Date?

    public init(
        id: UUID = UUID(),
        studentCode: String,
        studentAlias: String = "",
        date: Date,
        start: Date? = nil,
        end: Date? = nil,
        plannedMinutes: Int = 30,
        groupSize: Int = 1,
        attendance: Attendance = .present,
        delivery: Delivery = .inPerson,
        isMakeUp: Bool = false,
        activities: [Activity] = [],
        goals: [GoalSnapshot] = [],
        observations: [GoalObservation] = [],
        regulation: RegulationState? = nil,
        engagement: Int? = nil,
        progress: ProgressIndicator? = nil,
        comment: String = "",
        signedAt: Date? = nil
    ) {
        self.id = id
        self.studentCode = studentCode
        self.studentAlias = studentAlias
        self.date = date
        self.start = start
        self.end = end
        self.plannedMinutes = plannedMinutes
        self.groupSize = groupSize
        self.attendance = attendance
        self.delivery = delivery
        self.isMakeUp = isMakeUp
        self.activities = activities
        self.goals = goals
        self.observations = observations
        self.regulation = regulation
        self.engagement = engagement
        self.progress = progress
        self.comment = comment
        self.signedAt = signedAt
    }

    /// Exact minutes between start and end, never rounded up (SBAP rule). Nil until both are set.
    public var minutes: Int? {
        guard let start, let end, end > start else { return nil }
        return Int(end.timeIntervalSince(start) / 60.0)
    }

    public var serviceType: String {
        sbapServiceType(attendance: attendance, delivery: delivery, isMakeUp: isMakeUp)
    }

    public func observation(for goal: GoalSnapshot) -> GoalObservation? {
        observations.first { $0.goalID == goal.id }
    }
}

/// Real identity held only in the on-device vault; joined to records at export time.
public struct StudentIdentity: Codable, Hashable, Sendable {
    public var realName: String
    public var dateOfBirth: String
    public var paSecureID: String
    public var diagnosis: String

    public init(realName: String, dateOfBirth: String = "", paSecureID: String = "", diagnosis: String = "") {
        self.realName = realName
        self.dateOfBirth = dateOfBirth
        self.paSecureID = paSecureID
        self.diagnosis = diagnosis
    }
}

/// Shared formatting so notes, CSV and PDF agree.
public struct TimeStyle: Sendable {
    public var timeZone: TimeZone

    public init(timeZone: TimeZone = .current) {
        self.timeZone = timeZone
    }

    private func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = format
        return f
    }

    /// "9:15 AM"
    public func time(_ date: Date) -> String { formatter("h:mm a").string(from: date) }
    /// "10/07/2026"
    public func date(_ date: Date) -> String { formatter("MM/dd/yyyy").string(from: date) }
    /// "October 7, 2026"
    public func longDate(_ date: Date) -> String { formatter("MMMM d, yyyy").string(from: date) }
}
