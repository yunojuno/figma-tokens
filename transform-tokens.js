import StyleDictionary from 'style-dictionary';
import { register } from '@tokens-studio/sd-transforms';

import { expandTypesMap } from '@tokens-studio/sd-transforms';

register(StyleDictionary, {
  excludeParentKeys: true,
  alwaysAddFontStyle: true,
});
// register(StyleDictionary);

const sd = new StyleDictionary({
  "source": ["tokens.json"],
  "preprocessors": ["tokens-studio"],
  "expand": {
    "typesMap": expandTypesMap,
  },
  "platforms": {
    "web": {
      "transformGroup": "tokens-studio",
      "buildPath": "build/",
      "transforms": ['name/kebab'],
      "files": [
        {
          "format": "css/variables",
          "destination": "_generated_variables.css"
        }
      ]
    }
  }
});

await sd.cleanAllPlatforms();
await sd.buildAllPlatforms();