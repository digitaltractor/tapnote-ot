import Foundation
import Security
import TapNoteCore

/// Real student identities (name, DOB, PA Secure ID, diagnosis), keyed by student code.
/// Stored only in this device's Keychain: `WhenUnlockedThisDeviceOnly`, so the items are
/// excluded from iCloud Keychain and never migrate to another device or backup.
/// Showing them is gated by Face ID in the UI (see `Authenticator`).
enum IdentityVault {
    enum VaultError: LocalizedError {
        case keychain(OSStatus)
        var errorDescription: String? {
            switch self {
            case .keychain(let status): return "Keychain error \(status)"
            }
        }
    }

    private static let service = "com.digitaltractor.tapnote.identity-vault"

    private static func baseQuery(code: String? = nil) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service
        ]
        if let code { query[kSecAttrAccount as String] = code }
        return query
    }

    static func save(_ identity: StudentIdentity, for code: String) throws {
        let data = try JSONEncoder().encode(identity)
        SecItemDelete(baseQuery(code: code) as CFDictionary)
        var add = baseQuery(code: code)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw VaultError.keychain(status) }
    }

    static func identity(for code: String) -> StudentIdentity? {
        var query = baseQuery(code: code)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(StudentIdentity.self, from: data)
    }

    /// code -> identity for every stored student.
    static func all() -> [String: StudentIdentity] {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitAll
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let items = result as? [[String: Any]] else { return [:] }
        var map: [String: StudentIdentity] = [:]
        for item in items {
            guard let code = item[kSecAttrAccount as String] as? String,
                  let data = item[kSecValueData as String] as? Data,
                  let identity = try? JSONDecoder().decode(StudentIdentity.self, from: data) else { continue }
            map[code] = identity
        }
        return map
    }

    /// code -> real name, used only to scrub names out of free-text comments on this device.
    static func namesForScrubbing() -> [String: String] {
        all().compactMapValues { $0.realName.isEmpty ? nil : $0.realName }
    }

    static func delete(code: String) {
        SecItemDelete(baseQuery(code: code) as CFDictionary)
    }
}
