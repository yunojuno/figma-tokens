# Figma tokens

Installed on yunojuno repositories with the following command
```
npm install github:yunojuno/figma-tokens#<release-version> --save-dev
```


## Releasing a new version
When you have got to a point where you want to make a new release do the following.
1. Ensure the tokens and build folder have been updated. This should have ran in the actions tab. See it [here](https://github.com/yunojuno/figma-tokens/actions).
2. Update the package.json "version" to reflect the new version. See it [here](https://github.com/yunojuno/figma-tokens/main/package.json#L3)
3. Create a new release and tag which match the version in the package.json. Ensure "latest release" is checked. Do that [here](https://github.com/yunojuno/figma-tokens/releases/new).
4. Notify the dev team at #dev.

NOTE: You will not see a new release propagate to platform environments until the dependency is updated. This can be done either as part of the normal weekly dependency updates process, or if you need the changes more immediately you can run `npm install @yunojuno/figma-tokens@github:yunojuno/figma-tokens#<release-version>`.
