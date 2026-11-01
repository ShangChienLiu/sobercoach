import XCTest

/// End-to-end: real simulator, real local Supabase, real chat function (mock model gateway).
final class SoberCoachUITests: XCTestCase {
    func testSignInLogAndCorrect() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-reset"]
        app.launch()

        // Sign in as seeded test user A if the auth screen is showing.
        let alex = app.buttons["Sign in as Alex (user A)"]
        if alex.waitForExistence(timeout: 10) { alex.tap() }

        // Age gate (first run on a fresh install may already be confirmed server-side).
        let ageToggle = app.switches["I confirm I am 21 or older"]
        if ageToggle.waitForExistence(timeout: 5) {
            ageToggle.tap()
            app.buttons["Continue"].tap()
        }

        if !app.tabBars.buttons["Coach"].waitForExistence(timeout: 20) {
            let alertText = app.alerts.firstMatch.exists ? app.alerts.firstMatch.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: " | ") : "no alert"
            XCTFail("main tabs did not appear. alert=\(alertText)\n\(app.debugDescription.prefix(3000))")
            return
        }
        app.tabBars.buttons["Coach"].tap()

        let field = app.textFields["Had 2 beers…"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("2 beers")
        app.buttons["arrow.up.circle.fill"].firstMatch.tap()

        // The receipt for a typed log lives in the entry card (count × drink · day); the bubble carries the words.
        let logged = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH '2 × beer'")).firstMatch
        XCTAssertTrue(logged.waitForExistence(timeout: 30), "entry card did not arrive")

        field.tap()
        field.typeText("Actually it was 3")
        app.buttons["arrow.up.circle.fill"].firstMatch.tap()
        let updated = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH '3 × beer'")).firstMatch
        XCTAssertTrue(updated.waitForExistence(timeout: 30), "corrected card did not arrive")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Before: 2'")).firstMatch.waitForExistence(timeout: 5), "card does not show the previous count")

        // Undo from the card restores 2.
        app.buttons["Undo"].firstMatch.tap()
        let restored = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Restored 2 beers'")).firstMatch
        XCTAssertTrue(restored.waitForExistence(timeout: 20), "undo did not restore")

        // Dismiss the keyboard so the tab bar is reachable, then open Today.
        let done = app.buttons["keyboardDone"]
        if done.waitForExistence(timeout: 3) { done.tap() }
        XCTAssertTrue(app.tabBars.buttons["Today"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Today"].tap()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 10))
        let weekLabel = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'This week' OR label CONTAINS 'left this week'")).firstMatch
        XCTAssertTrue(weekLabel.waitForExistence(timeout: 10), "week summary not shown")
        XCTAssertTrue(app.buttons["Beer"].exists || app.staticTexts["Beer"].exists, "quick-log buttons not shown")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.lifetime = .keepAlways
        add(shot)
    }
}
