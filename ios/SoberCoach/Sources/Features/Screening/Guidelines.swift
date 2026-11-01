import Foundation

/// US clinical basis mirrored from the server's guidelines.ts: NIAAA low-risk lines and AUDIT-C cut-points.
enum Guidelines {
    struct Thresholds { let perDay: Int; let perWeek: Int; let bingeIn2h: Int; let auditCPositive: Int }

    /// Unknown sex applies the lower (women's) lines, the conservative reading.
    static func thresholds(sex: String?) -> Thresholds {
        sex == "male" ? Thresholds(perDay: 4, perWeek: 14, bingeIn2h: 5, auditCPositive: 4)
                      : Thresholds(perDay: 3, perWeek: 7, bingeIn2h: 4, auditCPositive: 3)
    }

    enum Band: String { case negative, positive, high }

    static func band(score: Int, sex: String?) -> Band {
        if score >= 8 { return .high }
        return score >= thresholds(sex: sex).auditCPositive ? .positive : .negative
    }

    static func bandText(_ band: Band) -> String {
        switch band {
        case .negative: return "Below the screening threshold. The coach keeps to your own weekly limit."
        case .positive: return "At or above the screening threshold, which the US Preventive Services Task Force reads as a reason for a short conversation about drinking. The coach tracks against the NIAAA low-risk lines for you."
        case .high: return "In the range where the questionnaire alone suggests a fuller assessment. A doctor can tell you more than this app can. The coach will not nag you about it, and never gives withdrawal or detox advice."
        }
    }

    /// AUDIT-C (Bush et al. 1998), the three-item version used in US primary care.
    static let questions: [(text: String, options: [String])] = [
        ("How often do you have a drink containing alcohol?",
         ["Never", "Monthly or less", "2 to 4 times a month", "2 to 3 times a week", "4 or more times a week"]),
        ("How many standard drinks do you have on a typical day when you are drinking?",
         ["1 or 2", "3 or 4", "5 or 6", "7 to 9", "10 or more"]),
        ("How often do you have six or more drinks on one occasion?",
         ["Never", "Less than monthly", "Monthly", "Weekly", "Daily or almost daily"]),
    ]
}
