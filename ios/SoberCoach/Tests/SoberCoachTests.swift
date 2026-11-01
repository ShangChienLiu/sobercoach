import XCTest
@testable import SoberCoach

final class ServiceDateTests: XCTestCase {
    func testLateNightBelongsToPreviousServiceDay() {
        // 2026-10-31 01:30 PDT = 08:30Z
        let d = ISO8601DateFormatter().date(from: "2026-10-31T08:30:00Z")!
        XCTAssertEqual(AppState.serviceDate(for: d, tz: "America/Los_Angeles", rollover: 4), "2026-10-30")
    }

    func testRolloverBoundary() {
        let d = ISO8601DateFormatter().date(from: "2026-10-31T11:00:00Z")! // 04:00 PDT
        XCTAssertEqual(AppState.serviceDate(for: d, tz: "America/Los_Angeles", rollover: 4), "2026-10-31")
    }

    func testStdFormatting() {
        XCTAssertEqual(formatStd(2, estimate: true), "~2.0 (est.)")
        XCTAssertEqual(formatStd(1.5, estimate: false), "1.5")
    }

    func testChatStateDecodesNoData() throws {
        let json = """
        {"weekly_total":0,"weekly_remaining":14,"weekly_limit":14,"has_nominal":false,"today":"NO_DATA","today_service_date":"2026-10-30"}
        """.data(using: .utf8)!
        let s = try JSONDecoder().decode(ChatState.self, from: json)
        XCTAssertEqual(s.today, .noData)
    }
}
