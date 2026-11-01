import Foundation
import UserNotifications
import UIKit

/// Push registration, the "Stop these" category, and a local-notification fallback
/// used when the simulator cannot receive APNs.
@MainActor
final class PushService: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = PushService()
    @Published var authorized = false
    @Published var lastStoppedCategory: String?
    var onStopCategory: ((String) async -> Void)?
    var onOpenReminder: ((UUID?) async -> Void)?

    func configure() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let stop = UNNotificationAction(identifier: AppConfig.stopActionId, title: "Stop these", options: [.destructive, .authenticationRequired])
        let open = UNNotificationAction(identifier: AppConfig.logActionId, title: "Log now", options: [.foreground])
        let category = UNNotificationCategory(identifier: AppConfig.pushCategory, actions: [open, stop], intentIdentifiers: [], options: [])
        center.setNotificationCategories([category])
        Task { await refreshAuthorization() }
    }

    func requestPermission() async {
        let center = UNUserNotificationCenter.current()
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            authorized = granted
            if granted { UIApplication.shared.registerForRemoteNotifications() }
        } catch {
            authorized = false
        }
    }

    func refreshAuthorization() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorized = settings.authorizationStatus == .authorized
        if authorized { UIApplication.shared.registerForRemoteNotifications() }
    }

    /// Shows a local notification carrying the same category and payload as a real push.
    func showLocal(title: String, body: String, trigger: String, reminderId: String?) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.categoryIdentifier = AppConfig.pushCategory
        content.threadIdentifier = trigger
        content.userInfo = ["trigger": trigger, "reminder_id": reminderId ?? "", "local_fallback": true]
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content,
                                            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
        UNUserNotificationCenter.current().add(request)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let trigger = info["trigger"] as? String ?? "all"
        let reminderId = (info["reminder_id"] as? String).flatMap(UUID.init(uuidString:))
        if response.actionIdentifier == AppConfig.stopActionId {
            await MainActor.run { self.lastStoppedCategory = trigger }
            if let handler = await MainActor.run(body: { self.onStopCategory }) { await handler(trigger) }
        } else {
            if let handler = await MainActor.run(body: { self.onOpenReminder }) { await handler(reminderId) }
        }
    }
}
