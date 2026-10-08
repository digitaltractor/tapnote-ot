import Foundation

public struct ComposedNote: Equatable, Sendable {
    public struct Section: Equatable, Sendable {
        public var title: String
        public var text: String
    }

    public var format: NoteFormat
    public var sections: [Section]
    /// Things the template could not fill from the data. Shown to the therapist, never invented.
    public var missing: [String]

    public var plainText: String {
        sections.map { $0.title.isEmpty ? $0.text : "\($0.title): \($0.text)" }.joined(separator: "\n\n")
    }
}

/// Builds a fact-only session note from structured capture data.
/// Every sentence comes from a recorded value; gaps become bracketed placeholders plus an entry in `missing`.
public struct NoteComposer: Sendable {
    public var timeStyle: TimeStyle

    public init(timeStyle: TimeStyle = TimeStyle()) {
        self.timeStyle = timeStyle
    }

    public func compose(_ s: SessionSnapshot, format: NoteFormat) -> ComposedNote {
        var missing: [String] = []

        guard s.attendance.serviceDelivered else {
            let text = "\(s.attendance.label) (\(s.serviceType)). No service delivered; \(s.plannedMinutes) scheduled minutes logged for make-up."
            return ComposedNote(format: format, sections: [.init(title: "", text: text)], missing: [])
        }

        // Subjective / presentation
        var subjective: [String] = []
        if let reg = s.regulation {
            subjective.append("Presented \(reg.rawValue.lowercased()) on arrival.")
        } else {
            missing.append("Regulation state")
        }
        if let eng = s.engagement {
            subjective.append("Engagement \(eng)/5.")
        } else {
            missing.append("Engagement rating")
        }
        let subjectiveText = subjective.isEmpty ? "[Add presentation]" : subjective.joined(separator: " ")

        // Objective
        var objective: [String] = []
        let setting = s.groupSize > 1 ? "Group session (\(s.groupSize) students)" : "Individual session"
        if let start = s.start, let end = s.end, let minutes = s.minutes {
            objective.append("\(setting), \(s.delivery.label.lowercased()), \(timeStyle.time(start))–\(timeStyle.time(end)) (\(minutes) min)\(s.isMakeUp ? ", make-up session" : "").")
        } else {
            objective.append("\(setting), \(s.delivery.label.lowercased()).")
            missing.append("Start and end time")
        }
        if s.activities.isEmpty {
            missing.append("Activities")
        } else {
            objective.append("Activities: \(s.activities.map { $0.name.lowercased() }.joined(separator: ", ")).")
        }
        var anyGoal = false
        for goal in s.goals.sorted(by: { $0.number < $1.number }) {
            guard let obs = s.observation(for: goal), obs.total > 0, let pct = obs.percent else { continue }
            anyGoal = true
            var line = "Goal \(goal.number) (\(goal.shortName)): \(obs.correct)/\(obs.total) trials correct (\(pct)%)"
            if let prompt = obs.promptLevelName {
                line += prompt == "Independent" ? ", independent" : " with \(prompt.lowercased()) prompts"
            }
            objective.append(line + ".")
        }
        if !anyGoal { missing.append("Goal trial data") }
        let trimmedComment = s.comment.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedComment.isEmpty {
            objective.append("Therapist comment: \(trimmedComment)")
        }
        let objectiveText = objective.joined(separator: " ")

        // Assessment
        var assessment: [String] = []
        if let progress = s.progress {
            assessment.append("Session progress: \(progress.label.lowercased()).")
        } else {
            missing.append("Progress indicator")
        }
        for goal in s.goals.sorted(by: { $0.number < $1.number }) {
            guard let crit = goal.criterionPercent, let pct = s.observation(for: goal)?.percent else { continue }
            let relation = pct >= crit ? "meets" : "is below"
            assessment.append("Goal \(goal.number) accuracy (\(pct)%) \(relation) the \(crit)% criterion.")
        }
        let assessmentText = assessment.isEmpty ? "[Add assessment]" : assessment.joined(separator: " ")

        let planText = "Continue IEP goals per the current service plan. [Add plan details]"

        let sections: [ComposedNote.Section]
        switch format {
        case .soap:
            sections = [
                .init(title: "S", text: subjectiveText),
                .init(title: "O", text: objectiveText),
                .init(title: "A", text: assessmentText),
                .init(title: "P", text: planText)
            ]
        case .dap:
            sections = [
                .init(title: "D", text: subjectiveText + " " + objectiveText),
                .init(title: "A", text: assessmentText),
                .init(title: "P", text: planText)
            ]
        case .narrative:
            sections = [.init(title: "", text: [subjectiveText, objectiveText, assessmentText, planText].joined(separator: " "))]
        }
        return ComposedNote(format: format, sections: sections, missing: missing)
    }
}
