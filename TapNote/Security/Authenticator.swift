import Foundation
import LocalAuthentication

/// Face ID / Touch ID / passcode check before showing names, signing, or exporting identified files.
enum Authenticator {
    static func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            #if targetEnvironment(simulator)
            return true // Simulators often have no passcode configured.
            #else
            return false
            #endif
        }
        do {
            return try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        } catch {
            return false
        }
    }
}
