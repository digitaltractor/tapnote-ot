import Foundation
import CryptoKit
import CommonCrypto
import SwiftData
import TapNoteCore

/// Passphrase-encrypted backup of all pseudonymous data (no names: the vault stays on the device).
/// File layout: "TNB1" | salt (16 bytes) | iterations (UInt32, big-endian) | AES-GCM combined box.
/// Key: PBKDF2-HMAC-SHA256 over the passphrase.
enum BackupService {
    enum BackupError: LocalizedError {
        case badFile, wrongPassphrase, keyDerivation
        var errorDescription: String? {
            switch self {
            case .badFile: return "This isn't a TapNote backup file."
            case .wrongPassphrase: return "The passphrase didn't match this backup."
            case .keyDerivation: return "Couldn't derive the encryption key."
            }
        }
    }

    static let magic = Data("TNB1".utf8)
    static let iterations: UInt32 = 310_000

    // MARK: Payload

    struct Payload: Codable {
        var version = 1
        var createdAt = Date()
        var students: [StudentDTO]
        var sessions: [SessionDTO]
    }

    struct StudentDTO: Codable {
        var code, alias, gradeBand, serviceMode, reportCadence: String
        var weeklyMinutes: Int
        var isActive: Bool
        var goals: [GoalDTO]
    }

    struct GoalDTO: Codable {
        var id: UUID
        var number: Int
        var shortName, detail: String
        var criterionPercent: Int
        var isActive: Bool
    }

    struct SessionDTO: Codable {
        var id, groupKey: UUID
        var studentCode: String
        var groupSize, plannedMinutes: Int
        var date: Date
        var start, end: Date?
        var attendanceRaw, deliveryRaw: String
        var isMakeUp: Bool
        var activities: [Activity]
        var observations: [GoalObservation]
        var regulationRaw, progressRaw: String?
        var engagement: Int?
        var comment: String
        var noteText, noteFormatRaw, signerName: String?
        var signedAt: Date?
        var addenda: [Addendum]
    }

    // MARK: Export / import

    static func export(context: ModelContext, passphrase: String) throws -> Data {
        let students = try context.fetch(FetchDescriptor<StudentRecord>())
        let sessions = try context.fetch(FetchDescriptor<SessionRecord>())
        let payload = Payload(
            students: students.map { s in
                StudentDTO(code: s.code, alias: s.alias, gradeBand: s.gradeBand, serviceMode: s.serviceMode, reportCadence: s.reportCadence,
                           weeklyMinutes: s.weeklyMinutes, isActive: s.isActive,
                           goals: s.goals.map { GoalDTO(id: $0.id, number: $0.number, shortName: $0.shortName, detail: $0.detail, criterionPercent: $0.criterionPercent, isActive: $0.isActive) })
            },
            sessions: sessions.map { r in
                SessionDTO(id: r.id, groupKey: r.groupKey, studentCode: r.studentCode, groupSize: r.groupSize, plannedMinutes: r.plannedMinutes,
                           date: r.date, start: r.start, end: r.end, attendanceRaw: r.attendanceRaw, deliveryRaw: r.deliveryRaw, isMakeUp: r.isMakeUp,
                           activities: r.activities, observations: r.observations, regulationRaw: r.regulationRaw, progressRaw: r.progressRaw,
                           engagement: r.engagement, comment: r.comment, noteText: r.noteText, noteFormatRaw: r.noteFormatRaw,
                           signerName: r.signerName, signedAt: r.signedAt, addenda: r.addenda)
            }
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let plain = try encoder.encode(payload)
        return try encrypt(plain, passphrase: passphrase)
    }

    /// Replaces all local data with the backup's contents.
    static func restore(_ file: Data, passphrase: String, into context: ModelContext) throws {
        let plain = try decrypt(file, passphrase: passphrase)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let payload = try decoder.decode(Payload.self, from: plain)

        try context.delete(model: SessionRecord.self)
        try context.delete(model: GoalRecord.self)
        try context.delete(model: StudentRecord.self)

        var byCode: [String: StudentRecord] = [:]
        for dto in payload.students {
            let s = StudentRecord(code: dto.code, alias: dto.alias, gradeBand: dto.gradeBand, serviceMode: dto.serviceMode, weeklyMinutes: dto.weeklyMinutes, reportCadence: dto.reportCadence)
            s.isActive = dto.isActive
            context.insert(s)
            for g in dto.goals {
                let goal = GoalRecord(number: g.number, shortName: g.shortName, detail: g.detail, criterionPercent: g.criterionPercent)
                goal.id = g.id
                goal.isActive = g.isActive
                goal.student = s
                context.insert(goal)
            }
            byCode[dto.code] = s
        }
        for dto in payload.sessions {
            guard let student = byCode[dto.studentCode] else { continue }
            let r = SessionRecord(student: student, groupKey: dto.groupKey, groupSize: dto.groupSize, start: dto.start, plannedMinutes: dto.plannedMinutes)
            r.id = dto.id
            r.date = dto.date
            r.end = dto.end
            r.attendanceRaw = dto.attendanceRaw
            r.deliveryRaw = dto.deliveryRaw
            r.isMakeUp = dto.isMakeUp
            r.activities = dto.activities
            r.observations = dto.observations
            r.regulationRaw = dto.regulationRaw
            r.progressRaw = dto.progressRaw
            r.engagement = dto.engagement
            r.comment = dto.comment
            r.noteText = dto.noteText
            r.noteFormatRaw = dto.noteFormatRaw
            r.signerName = dto.signerName
            r.signedAt = dto.signedAt
            r.addenda = dto.addenda
            context.insert(r)
        }
        context.audit("Backup", "restore", "restored", "\(payload.students.count) students, \(payload.sessions.count) sessions from \(payload.createdAt)")
        try context.save()
    }

    // MARK: Crypto

    static func encrypt(_ plain: Data, passphrase: String) throws -> Data {
        var salt = Data(count: 16)
        let status = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        guard status == errSecSuccess else { throw BackupError.keyDerivation }
        let key = try deriveKey(passphrase: passphrase, salt: salt, iterations: iterations)
        let box = try AES.GCM.seal(plain, using: key)
        guard let combined = box.combined else { throw BackupError.keyDerivation }
        var out = magic
        out.append(salt)
        var be = iterations.bigEndian
        out.append(Data(bytes: &be, count: 4))
        out.append(combined)
        return out
    }

    static func decrypt(_ file: Data, passphrase: String) throws -> Data {
        guard file.count > 4 + 16 + 4 + 28, file.prefix(4) == magic else { throw BackupError.badFile }
        let salt = file.subdata(in: 4..<20)
        let iterBytes = [UInt8](file.subdata(in: 20..<24))
        let iters = iterBytes.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        let key = try deriveKey(passphrase: passphrase, salt: salt, iterations: iters)
        do {
            let box = try AES.GCM.SealedBox(combined: file.subdata(in: 24..<file.count))
            return try AES.GCM.open(box, using: key)
        } catch {
            throw BackupError.wrongPassphrase
        }
    }

    static func deriveKey(passphrase: String, salt: Data, iterations: UInt32) throws -> SymmetricKey {
        let saltBytes = [UInt8](salt)
        var derived = [UInt8](repeating: 0, count: 32)
        let result = CCKeyDerivationPBKDF(
            CCPBKDFAlgorithm(kCCPBKDF2),
            passphrase, passphrase.utf8.count,
            saltBytes, saltBytes.count,
            CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
            iterations,
            &derived, derived.count
        )
        guard result == Int32(kCCSuccess) else { throw BackupError.keyDerivation }
        return SymmetricKey(data: derived)
    }
}
