package com.resilios

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.resilios.files.FilesPackage
import com.resilios.location.LocationPackage
import com.resilios.photo.PhotoPackage
import com.resilios.reminders.ReminderPackage
import com.resilios.screen.ScreenPackage
import com.resilios.update.UpdatePackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Mise à jour depuis les versions publiées sur GitHub.
          add(UpdatePackage())
          // Photos d'armes et de documents, stockées dans le coffre.
          add(PhotoPackage())
          // Réglage des captures d'écran.
          add(ScreenPackage())
          // Rappels de péremption (horaires seulement, texte neutre).
          add(ReminderPackage())
          // Sauvegarde chiffrée et export : fichiers choisis par l'utilisateur.
          add(FilesPackage())
          // Position GPS à la demande (écran Urgence).
          add(LocationPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
