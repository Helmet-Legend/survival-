package com.resilios.location

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class LocationPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
      listOf(LocationModule(context), CompassModule(context))

  override fun createViewManagers(
      context: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
