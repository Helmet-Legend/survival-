# Modules natifs iOS de Fenrir : mêmes noms et mêmes méthodes que les
# modules Android (android/app/src/main/java/com/resilios/), pour que
# l'interface JavaScript soit identique sur les deux téléphones.
Pod::Spec.new do |s|
  s.name = "FenrirNative"
  s.version = "1.0.0"
  s.summary = "Modules natifs iOS de Fenrir"
  s.homepage = "https://github.com/Helmet-Legend/survival-"
  s.license = { :type => "Proprietary" }
  s.author = "Fenrir"
  s.platforms = { :ios => "15.1" }
  s.source = { :git => "https://github.com/Helmet-Legend/survival-.git" }
  s.source_files = "*.{h,m,swift}"
  s.swift_version = "5.9"
  s.frameworks = "CoreLocation", "UserNotifications", "AVFoundation", "Network",
                 "PhotosUI", "UniformTypeIdentifiers", "VisionKit", "WebKit"
  install_modules_dependencies(s)
end
