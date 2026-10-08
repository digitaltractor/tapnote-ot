import Foundation

/// Builds a CSV shaped like the PA SBAP OT Service Provider Log
/// (Date, Start, End, Treatment Key, Group Size, Service Type, Progress Indicator, Description).
/// Identity columns are filled only when the caller supplies a lookup, which the app does
/// on-device after Face ID, at export time.
public struct SBAPExport: Sendable {
    public var timeStyle: TimeStyle
    public var composer: NoteComposer

    public init(timeStyle: TimeStyle = TimeStyle()) {
        self.timeStyle = timeStyle
        self.composer = NoteComposer(timeStyle: timeStyle)
    }

    public static let pseudonymousHeader = ["Student Code", "Date", "Start", "End", "Treatment Key", "Group Size", "Service Type", "Progress Indicator", "Description"]
    public static let identifiedHeader = ["Student Name", "DOB", "PA Secure ID"] + pseudonymousHeader

    public func csv(sessions: [SessionSnapshot], noteText: (SessionSnapshot) -> String? = { _ in nil }, identity: ((String) -> StudentIdentity?)? = nil) -> String {
        var rows: [[String]] = [identity == nil ? Self.pseudonymousHeader : Self.identifiedHeader]
        let ordered = sessions.sorted { ($0.start ?? $0.date, $0.studentCode) < ($1.start ?? $1.date, $1.studentCode) }
        for s in ordered {
            let keys = s.activities.compactMap { $0.sbapKey }.map(String.init).joined(separator: "; ")
            let description = noteText(s) ?? composer.compose(s, format: .narrative).plainText
            var row = [
                s.studentCode,
                timeStyle.date(s.date),
                s.start.map(timeStyle.time) ?? "",
                s.end.map(timeStyle.time) ?? "",
                keys,
                String(s.groupSize),
                s.serviceType,
                s.attendance.serviceDelivered ? (s.progress?.sbapCode ?? "") : "",
                description
            ]
            if let identity {
                let id = identity(s.studentCode)
                row = [id?.realName ?? "", id?.dateOfBirth ?? "", id?.paSecureID ?? ""] + row
            }
            rows.append(row)
        }
        return rows.map { $0.map(Self.escape).joined(separator: ",") }.joined(separator: "\r\n") + "\r\n"
    }

    static func escape(_ field: String) -> String {
        // Neutralize spreadsheet formula injection, then quote when needed.
        var value = field
        if let first = value.first, "=+-@".contains(first) {
            value = "'" + value
        }
        if value.contains(where: { $0 == "," || $0 == "\"" || $0 == "\n" || $0 == "\r" }) {
            return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return value
    }
}
