import Foundation

public enum ReportPeriod: String, Codable, CaseIterable, Identifiable, Sendable {
    case month
    case quarter
    case year
    case custom

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .month: return "Month"
        case .quarter: return "Quarter"
        case .year: return "Year"
        case .custom: return "Custom"
        }
    }

    /// Date range ending at `end` (inclusive of that day).
    public func range(endingAt end: Date, calendar: Calendar = .current) -> ClosedRange<Date> {
        let endOfDay = calendar.date(bySettingHour: 23, minute: 59, second: 59, of: end) ?? end
        let months: Int
        switch self {
        case .month: months = 1
        case .quarter: months = 3
        case .year, .custom: months = 12
        }
        let start = calendar.date(byAdding: .month, value: -months, to: calendar.startOfDay(for: end)) ?? end
        return start...endOfDay
    }
}

public struct GoalProgress: Equatable, Sendable {
    public enum Status: String, Sendable {
        case met = "Goal met"
        case progressing = "Progressing"
        case notProgressing = "Not progressing"
        case insufficientData = "Not enough data"
    }

    public struct Point: Equatable, Sendable {
        public var date: Date
        public var percent: Int
        public var promptLevelName: String?
    }

    public var goal: GoalSnapshot
    public var points: [Point]
    public var status: Status
    public var narrative: String

    public var first: Int? { points.first?.percent }
    public var last: Int? { points.last?.percent }
    public var average: Int? {
        guard !points.isEmpty else { return nil }
        return Int((Double(points.map(\.percent).reduce(0, +)) / Double(points.count)).rounded())
    }
}

/// Summarizes goal data over a period from recorded sessions only.
public struct ProgressReportComposer: Sendable {
    public var timeStyle: TimeStyle

    public init(timeStyle: TimeStyle = TimeStyle()) {
        self.timeStyle = timeStyle
    }

    public func progress(for goal: GoalSnapshot, sessions: [SessionSnapshot], in range: ClosedRange<Date>, periodLabel: String) -> GoalProgress {
        let points: [GoalProgress.Point] = sessions
            .filter { range.contains($0.date) && $0.attendance.serviceDelivered }
            .sorted { $0.date < $1.date }
            .compactMap { s in
                guard let obs = s.observation(for: goal), let pct = obs.percent else { return nil }
                return GoalProgress.Point(date: s.date, percent: pct, promptLevelName: obs.promptLevelName)
            }

        guard points.count >= 2, let first = points.first, let last = points.last else {
            let text = points.isEmpty
                ? "No data recorded for goal \(goal.number) (\(goal.shortName)) this \(periodLabel). [Add context]"
                : "One session of data for goal \(goal.number) (\(goal.shortName)) this \(periodLabel): \(points[0].percent)% correct. [Add context]"
            return GoalProgress(goal: goal, points: points, status: .insufficientData, narrative: text)
        }

        let slope = Self.slope(points.map(\.percent))
        let status: GoalProgress.Status
        if let crit = goal.criterionPercent, last.percent >= crit {
            status = .met
        } else if slope > 0.5 {
            status = .progressing
        } else {
            status = .notProgressing
        }

        let average = Int((Double(points.map(\.percent).reduce(0, +)) / Double(points.count)).rounded())
        var text = "Across \(points.count) sessions this \(periodLabel) (\(timeStyle.date(first.date))–\(timeStyle.date(last.date))), accuracy on \(goal.shortName.lowercased()) went from \(first.percent)% to \(last.percent)% (average \(average)%)"
        if let crit = goal.criterionPercent {
            text += " against a \(crit)% criterion"
        }
        text += "."
        if let p1 = first.promptLevelName, let p2 = last.promptLevelName, p1 != p2 {
            text += " Prompting changed from \(p1.lowercased()) to \(p2.lowercased())."
        }
        text += " [Add classroom observations and next steps]"
        return GoalProgress(goal: goal, points: points, status: status, narrative: text)
    }

    /// Least-squares slope in percentage points per session.
    static func slope(_ values: [Int]) -> Double {
        let n = Double(values.count)
        guard n >= 2 else { return 0 }
        let xs = (0..<values.count).map(Double.init)
        let ys = values.map(Double.init)
        let meanX = xs.reduce(0, +) / n
        let meanY = ys.reduce(0, +) / n
        var num = 0.0
        var den = 0.0
        for i in 0..<values.count {
            num += (xs[i] - meanX) * (ys[i] - meanY)
            den += (xs[i] - meanX) * (xs[i] - meanX)
        }
        return den == 0 ? 0 : num / den
    }
}
