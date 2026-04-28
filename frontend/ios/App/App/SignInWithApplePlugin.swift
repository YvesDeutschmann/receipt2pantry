import AuthenticationServices
import Capacitor

@objc(SignInWithApplePlugin)
public class SignInWithApplePlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "SignInWithApplePlugin"
    public let jsName = "SignInWithApple"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    private var currentCall: CAPPluginCall?

    @objc public func authorize(_ call: CAPPluginCall) {
        guard currentCall == nil else {
            call.reject("Sign in with Apple is already in progress.")
            return
        }

        let provider = ASAuthorizationAppleIDProvider()
        let request = provider.createRequest()
        let scopes = call.getString("scopes") ?? ""
        var requestedScopes: [ASAuthorization.Scope] = []

        if scopes.contains("email") {
            requestedScopes.append(.email)
        }
        if scopes.contains("name") {
            requestedScopes.append(.fullName)
        }
        if !requestedScopes.isEmpty {
            request.requestedScopes = requestedScopes
        }
        if let nonce = call.getString("nonce") {
            request.nonce = nonce
        }

        currentCall = call
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        DispatchQueue.main.async {
            controller.performRequests()
        }
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = currentCall else {
            return
        }
        currentCall = nil

        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            call.reject("Apple Sign-In did not return Apple ID credentials.")
            return
        }

        guard
            let identityToken = credential.identityToken,
            let identityTokenString = String(data: identityToken, encoding: .utf8)
        else {
            call.reject("Apple Sign-In did not return an identity token.")
            return
        }

        var response: [String: Any] = [
            "identityToken": identityTokenString,
            "user": credential.user
        ]

        if let email = credential.email {
            response["email"] = email
        }
        if let givenName = credential.fullName?.givenName {
            response["givenName"] = givenName
        }
        if let familyName = credential.fullName?.familyName {
            response["familyName"] = familyName
        }

        call.resolve(["response": response])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        currentCall?.reject(error.localizedDescription)
        currentCall = nil
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }
        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
