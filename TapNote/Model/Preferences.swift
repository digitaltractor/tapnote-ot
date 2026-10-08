import Foundation
import Observation
import TapNoteCore

/// Therapist settings and editable catalogs, stored in UserDefaults (no student data here).
@MainActor
@Observable
final class Preferences {
    private let defaults: UserDefaults

    var therapistName: String { didSet { defaults.set(therapistName, forKey: Keys.name) } }
    var credentials: String { didSet { defaults.set(credentials, forKey: Keys.credentials) } }
    var noteFormat: NoteFormat { didSet { defaults.set(noteFormat.rawValue, forKey: Keys.format) } }
    var defaultSessionMinutes: Int { didSet { defaults.set(defaultSessionMinutes, forKey: Keys.minutes) } }
    var promptLevels: [PromptLevel] { didSet { save(promptLevels, Keys.prompts) } }
    var activityCatalog: [Activity] { didSet { save(activityCatalog, Keys.activities) } }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        therapistName = defaults.string(forKey: Keys.name) ?? ""
        credentials = defaults.string(forKey: Keys.credentials) ?? "OTR/L"
        noteFormat = NoteFormat(rawValue: defaults.string(forKey: Keys.format) ?? "") ?? .soap
        let minutes = defaults.integer(forKey: Keys.minutes)
        defaultSessionMinutes = minutes > 0 ? minutes : 30
        promptLevels = Self.load([PromptLevel].self, Keys.prompts, defaults) ?? PromptLevel.defaults
        activityCatalog = Self.load([Activity].self, Keys.activities, defaults) ?? Activity.starterCatalog
    }

    var signature: String {
        let name = therapistName.trimmingCharacters(in: .whitespaces)
        if name.isEmpty { return credentials.isEmpty ? "[Therapist]" : "[Therapist], \(credentials)" }
        return credentials.isEmpty ? name : "\(name), \(credentials)"
    }

    var enabledPromptLevels: [PromptLevel] {
        promptLevels.filter(\.isEnabled).sorted { $0.rank < $1.rank }
    }

    private enum Keys {
        static let name = "therapistName"
        static let credentials = "credentials"
        static let format = "noteFormat"
        static let minutes = "defaultSessionMinutes"
        static let prompts = "promptLevels"
        static let activities = "activityCatalog"
    }

    private func save<T: Encodable>(_ value: T, _ key: String) {
        if let data = try? JSONEncoder().encode(value) {
            defaults.set(data, forKey: key)
        }
    }

    private static func load<T: Decodable>(_ type: T.Type, _ key: String, _ defaults: UserDefaults) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
