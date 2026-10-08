import Foundation
import SwiftData

enum AppStore {
    static let schema = Schema([StudentRecord.self, GoalRecord.self, SessionRecord.self, AuditEventRecord.self])

    static var directory: URL {
        URL.applicationSupportDirectory.appending(path: "TapNote", directoryHint: .isDirectory)
    }

    /// The database lives in Application Support with iOS Data Protection
    /// (`completeUnlessOpen`): encrypted at rest whenever the phone is locked.
    static func makeContainer(inMemory: Bool = false) throws -> ModelContainer {
        if inMemory {
            return try ModelContainer(for: schema, configurations: [ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)])
        }
        let fm = FileManager.default
        try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUnlessOpen])
        let url = directory.appending(path: "TapNote.store")
        let config = ModelConfiguration(schema: schema, url: url, cloudKitDatabase: .none)
        let container = try ModelContainer(for: schema, configurations: [config])
        applyProtection()
        return container
    }

    static func applyProtection() {
        let fm = FileManager.default
        try? fm.setAttributes([.protectionKey: FileProtectionType.completeUnlessOpen], ofItemAtPath: directory.path)
        if let files = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            for file in files {
                try? fm.setAttributes([.protectionKey: FileProtectionType.completeUnlessOpen], ofItemAtPath: file.path)
            }
        }
    }

    /// Exports are written here and cleared on every launch so identified files don't linger.
    static var exportDirectory: URL {
        FileManager.default.temporaryDirectory.appending(path: "Exports", directoryHint: .isDirectory)
    }

    static func clearExports() {
        try? FileManager.default.removeItem(at: exportDirectory)
    }

    static func writeExport(_ data: Data, named name: String) throws -> URL {
        let fm = FileManager.default
        try fm.createDirectory(at: exportDirectory, withIntermediateDirectories: true)
        let url = exportDirectory.appending(path: name)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }
}
