# Third-party build tools

The Gradle wrapper scripts and `gradle/wrapper/gradle-wrapper.jar` are unmodified files from [Gradle 8.12.1](https://github.com/gradle/gradle/tree/v8.12.1), distributed under Apache-2.0. The wrapper JAR SHA-256 is `2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046`, checked against Gradle's published checksum. See `gradle/wrapper/LICENSE` and the copyright headers in the wrapper scripts.

Minecraft, mappings, Fabric, JUnit and their transitive dependencies are resolved by the build. Minecraft client/server archives, textures, game worlds and account credentials are not redistributed in this source tree or the mod JAR. Fabric API is a separate installed mod dependency.
