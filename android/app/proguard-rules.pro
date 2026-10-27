# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# --- Fenrir ---------------------------------------------------------------
# Réduction du code (R8) en version finale. Les classes appelées depuis le
# code natif (JNI) ou par réflexion sont gardées telles quelles.

# Modules natifs de Fenrir (écran, rappels, fichiers, scanner, réseau…).
-keep class com.resilios.** { *; }

# Bibliothèques React Native avec code natif.
-keep class com.op.sqlite.** { *; }
-keep class com.poowf.argon2.** { *; }
-keep class com.oblador.keychain.** { *; }
-keep class com.horcrux.svg.** { *; }
-keep class com.th3rdwave.safeareacontext.** { *; }
-keep class org.linusu.** { *; }

# Argon2 (dérivation de la clé du coffre) et décodage Data Matrix : JNI.
-keep class com.lambdapioneer.argon2kt.** { *; }
-keep class zxingcpp.** { *; }
-dontwarn zxingcpp.**

# Lecteur de codes-barres ZXing (Java).
-keep class com.google.zxing.** { *; }

# Scanner de documents de Google Play (ML Kit) : en version réduite par R8,
# son lancement échouait sur NullPointerException. Ses classes et celles
# des services Google qu'il appelle sont gardées telles quelles.
-keep class com.google.mlkit.vision.documentscanner.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_documentscanner.** { *; }
-keep class com.google.mlkit.common.** { *; }
-keep class com.google.android.gms.common.internal.** { *; }
-keep class com.google.android.gms.tasks.** { *; }
-dontwarn com.google.mlkit.**
