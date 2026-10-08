import Foundation

/// Student codes like "K7-OTTER": a letter, a digit and a word, with look-alike characters
/// (I, O, 0, 1) left out so codes read cleanly aloud and on paper.
public enum PseudonymGenerator {
    static let letters = Array("ABCDEFGHJKLMNPQRSTUVWXYZ")
    static let digits = Array("23456789")
    public static let words = [
        "OTTER", "HERON", "MAPLE", "FINCH", "CEDAR", "WREN", "BIRCH", "ASPEN", "ROBIN", "FERN",
        "WILLOW", "SPARROW", "BADGER", "LARK", "ALDER", "PINE", "OAK", "MOSS", "CLOVER", "IRIS",
        "BEAVER", "CRANE", "DOVE", "EAGLE", "FALCON", "HAZEL", "JUNIPER", "LUPINE", "MARTEN", "OSPREY",
        "PLOVER", "QUAIL", "RAVEN", "SAGE", "TERN", "THRUSH", "TULIP", "VIOLET", "YARROW", "ZINNIA"
    ]

    public static func make<G: RandomNumberGenerator>(excluding existing: Set<String>, using rng: inout G) -> String {
        for _ in 0..<500 {
            let code = "\(letters.randomElement(using: &rng)!)\(digits.randomElement(using: &rng)!)-\(words.randomElement(using: &rng)!)"
            if !existing.contains(code) { return code }
        }
        // Practically unreachable; fall back to a longer unique suffix.
        return "S" + UUID().uuidString.prefix(6).uppercased()
    }

    public static func make(excluding existing: Set<String>) -> String {
        var rng = SystemRandomNumberGenerator()
        return make(excluding: existing, using: &rng)
    }

    /// Default alias: the word part, title-cased ("OTTER" -> "Otter").
    public static func alias(for code: String) -> String {
        guard let word = code.split(separator: "-").last else { return code }
        return word.prefix(1).uppercased() + word.dropFirst().lowercased()
    }
}

/// Replaces any real name (full, first or last) found in free text with the student's code
/// before text is stored or drafted. Matching is whole-word and case-insensitive.
public enum NameScrubber {
    public struct Result: Equatable, Sendable {
        public var text: String
        public var replacements: Int
    }

    /// - Parameter names: student code -> real name
    public static func scrub(_ text: String, names: [String: String]) -> Result {
        var output = text
        var count = 0
        // Longest names first so "Ava Smith" wins over "Ava".
        var pairs: [(String, String)] = []
        for (code, fullName) in names {
            let parts = fullName.split(whereSeparator: { $0 == " " || $0 == "-" }).map(String.init)
            var candidates = [fullName]
            candidates.append(contentsOf: parts.filter { $0.count >= 2 })
            for candidate in candidates {
                let trimmed = candidate.trimmingCharacters(in: .whitespaces)
                if !trimmed.isEmpty { pairs.append((trimmed, code)) }
            }
        }
        pairs.sort { $0.0.count > $1.0.count }
        for (name, code) in pairs {
            let pattern = "(?<![\\p{L}\\p{N}])" + NSRegularExpression.escapedPattern(for: name) + "(?![\\p{L}\\p{N}])"
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            let range = NSRange(output.startIndex..., in: output)
            let matches = regex.numberOfMatches(in: output, options: [], range: range)
            if matches > 0 {
                count += matches
                output = regex.stringByReplacingMatches(in: output, options: [], range: range, withTemplate: NSRegularExpression.escapedTemplate(for: code))
            }
        }
        return Result(text: output, replacements: count)
    }
}
