import Foundation

// MARK: - Prompt / assist levels

/// One level of a prompt hierarchy. `rank` 0 is the most independent.
/// Default list follows the least-to-most hierarchy in the AFIRM/UNC prompting packet;
/// the therapist can rename, reorder or disable levels in Settings.
public struct PromptLevel: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var shortName: String
    public var rank: Int
    public var isEnabled: Bool

    public init(id: String, name: String, shortName: String, rank: Int, isEnabled: Bool = true) {
        self.id = id
        self.name = name
        self.shortName = shortName
        self.rank = rank
        self.isEnabled = isEnabled
    }

    public static let defaults: [PromptLevel] = [
        PromptLevel(id: "independent", name: "Independent", shortName: "Ind", rank: 0),
        PromptLevel(id: "verbal", name: "Verbal", shortName: "Verbal", rank: 1),
        PromptLevel(id: "gestural", name: "Gestural", shortName: "Gesture", rank: 2),
        PromptLevel(id: "visual", name: "Visual", shortName: "Visual", rank: 3),
        PromptLevel(id: "model", name: "Model", shortName: "Model", rank: 4),
        PromptLevel(id: "partial-physical", name: "Partial physical", shortName: "Partial", rank: 5),
        PromptLevel(id: "full-physical", name: "Full physical", shortName: "Full", rank: 6)
    ]
}

// MARK: - Regulation, engagement, progress

/// Generic four-state regulation scale (deliberately not using a trademarked program name).
public enum RegulationState: String, Codable, CaseIterable, Identifiable, Sendable {
    case low = "Low"
    case calm = "Calm"
    case heightened = "Heightened"
    case high = "High"

    public var id: String { rawValue }
}

/// Session progress indicator; the codes match the PA SBAP OT service log key.
public enum ProgressIndicator: String, Codable, CaseIterable, Identifiable, Sendable {
    case mastering
    case progressing
    case maintaining
    case inconsistent
    case regressing

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .mastering: return "Mastering"
        case .progressing: return "Progressing"
        case .maintaining: return "Maintaining"
        case .inconsistent: return "Inconsistent"
        case .regressing: return "Regressing"
        }
    }

    public var sbapCode: String {
        switch self {
        case .mastering: return "Ms"
        case .progressing: return "Pr"
        case .maintaining: return "Mn"
        case .inconsistent: return "In"
        case .regressing: return "Rg"
        }
    }
}

// MARK: - Attendance and delivery (SBAP service type)

public enum Attendance: String, Codable, CaseIterable, Identifiable, Sendable {
    case present
    case studentAbsent
    case studentNotAvailable
    case providerAbsent
    case providerNotAvailable

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .present: return "Present"
        case .studentAbsent: return "Student absent"
        case .studentNotAvailable: return "Student not available"
        case .providerAbsent: return "Therapist absent"
        case .providerNotAvailable: return "Therapist not available"
        }
    }

    public var serviceDelivered: Bool { self == .present }
}

public enum Delivery: String, Codable, CaseIterable, Identifiable, Sendable {
    case inPerson
    /// Telehealth, student not at home (place of service 02).
    case telehealthNotHome
    /// Telehealth, student at home (place of service 10).
    case telehealthHome

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .inPerson: return "In person"
        case .telehealthNotHome: return "Telehealth (at school)"
        case .telehealthHome: return "Telehealth (at home)"
        }
    }
}

/// The SBAP "Service Type" column for a session.
public func sbapServiceType(attendance: Attendance, delivery: Delivery, isMakeUp: Bool) -> String {
    switch attendance {
    case .studentAbsent: return "SA"
    case .studentNotAvailable: return "SNA"
    case .providerAbsent: return "PA"
    case .providerNotAvailable: return "PNA"
    case .present:
        switch delivery {
        case .inPerson: return isMakeUp ? "DM" : "D"
        case .telehealthNotHome: return isMakeUp ? "02M" : "02"
        case .telehealthHome: return isMakeUp ? "10M" : "10"
        }
    }
}

// MARK: - Activities

/// An activity or focus area. `sbapKey` is the numbered treatment key on the PA SBAP OT log when known.
public struct Activity: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var sbapKey: Int?

    public init(id: String, name: String, sbapKey: Int? = nil) {
        self.id = id
        self.name = name
        self.sbapKey = sbapKey
    }

    /// Starter catalog. Keys 12, 19, 41 and 51 are taken from the SBAP OT Service Provider Log (rev. 04/2025).
    /// Add the remaining keys from that form in Settings; unknown keys are left blank rather than guessed.
    public static let starterCatalog: [Activity] = [
        Activity(id: "sbap-19", name: "Handwriting control", sbapKey: 19),
        Activity(id: "sbap-12", name: "Grasp / release", sbapKey: 12),
        Activity(id: "sbap-51", name: "Visual perception", sbapKey: 51),
        Activity(id: "sbap-41", name: "Self-regulation", sbapKey: 41),
        Activity(id: "scissor-skills", name: "Scissor skills"),
        Activity(id: "bilateral-coordination", name: "Bilateral coordination"),
        Activity(id: "fine-motor-strength", name: "Fine motor strengthening"),
        Activity(id: "self-care", name: "Self-care skills")
    ]
}

// MARK: - Note format

public enum NoteFormat: String, Codable, CaseIterable, Identifiable, Sendable {
    case soap
    case narrative
    case dap

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .soap: return "SOAP"
        case .narrative: return "Narrative"
        case .dap: return "DAP"
        }
    }
}
