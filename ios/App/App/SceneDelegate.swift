import UIKit
import WebKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = GameViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // A race is a few minutes of controller-only play with no touches: keep the screen on.
        UIApplication.shared.isIdleTimerDisabled = true
    }

    func sceneWillResignActive(_ scene: UIScene) {
        UIApplication.shared.isIdleTimerDisabled = false
    }
}

/// The game's web view: full screen, no scrolling, edge swipes deferred (the status bar and home indicator are
/// hidden by Capacitor's SystemBars plugin: `plugins.SystemBars.hidden` in capacitor.config.ts).
class GameViewController: CAPBridgeViewController {
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        // Gamepad presses are not user gestures in WebKit, so audio must be allowed to start without a tap.
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsInlineMediaPlayback = true
        return config
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        setStatusBarVisible(false)
        guard let webView = webView else { return }
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 5 / 255, green: 3 / 255, blue: 15 / 255, alpha: 1)
        // Safari → Develop → <device> → MachZero, for the perf panel and console on TestFlight builds.
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
    }

    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
}
