const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, value => {
    value.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
        }],
      },
    };
    return value;
  });
  return withAppDelegate(config, value => {
    if (value.modResults.contents.includes('class SceneDelegate')) return value;
    value.modResults.contents = value.modResults.contents.replace(
      /#if os\(iOS\) \|\| os\(tvOS\)[\s\S]*?#endif/,
      '',
    );
    value.modResults.contents += `
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }
    let sceneWindow = UIWindow(windowScene: windowScene)
    window = sceneWindow
    appDelegate.window = sceneWindow
    factory.startReactNative(withModuleName: "main", in: sceneWindow, launchOptions: nil)
  }
}
`;
    return value;
  });
};
