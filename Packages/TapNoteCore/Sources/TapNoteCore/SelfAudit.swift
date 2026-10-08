import Foundation

public struct AuditIssue: Equatable, Hashable, Sendable {
    public enum Severity: String, Sendable {
        /// Must be fixed before signing.
        case blocking
        /// Worth a look; does not stop signing.
        case warning
    }

    public var severity: Severity
    public var message: String

    public init(_ severity: Severity, _ message: String) {
        self.severity = severity
        self.message = message
    }
}

/// Pre-signature checks modeled on the PA SBAP self-audit record review:
/// exact times, service description, progress indicator, no double-billed minutes.
public enum SelfAudit {
    public static func check(_ s: SessionSnapshot, sameDay others: [SessionSnapshot] = [], weeklyAuthorizedMinutes: Int? = nil, minutesAlreadyThisWeek: Int = 0) -> [AuditIssue] {
        var issues: [AuditIssue] = []

        guard s.attendance.serviceDelivered else {
            return issues
        }

        if s.start == nil || s.end == nil {
            issues.append(AuditIssue(.blocking, "Add exact start and end times"))
        } else if s.minutes == nil {
            issues.append(AuditIssue(.blocking, "End time must be after start time"))
        }
        if s.progress == nil {
            issues.append(AuditIssue(.blocking, "Choose a progress indicator"))
        }
        if s.activities.isEmpty && s.comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            issues.append(AuditIssue(.blocking, "Describe the service: pick an activity or add a comment"))
        }
        if !s.observations.contains(where: { $0.total > 0 }) {
            issues.append(AuditIssue(.warning, "No goal data recorded"))
        }
        if s.groupSize < 1 {
            issues.append(AuditIssue(.blocking, "Group size must be at least 1"))
        }

        // Overlap with another session for a different group: minutes can't be billed twice.
        if let start = s.start, let end = s.end, end > start {
            for other in others where other.id != s.id && other.attendance.serviceDelivered {
                guard let oStart = other.start, let oEnd = other.end, oEnd > oStart else { continue }
                let sameGroup = other.start == s.start && other.end == s.end && other.groupSize == s.groupSize && s.groupSize > 1
                if !sameGroup && start < oEnd && oStart < end {
                    issues.append(AuditIssue(.blocking, "Overlaps the \(other.studentCode) session"))
                }
            }
        }

        if let authorized = weeklyAuthorizedMinutes, let minutes = s.minutes, minutesAlreadyThisWeek + minutes > authorized {
            issues.append(AuditIssue(.warning, "Exceeds \(authorized) authorized minutes this week"))
        }
        return issues
    }

    public static func isReadyToSign(_ issues: [AuditIssue]) -> Bool {
        !issues.contains { $0.severity == .blocking }
    }
}
