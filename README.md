# TranslatePerChat — «Переводчик чатов» for Vencord

> **[Installation guide for beginners — step by step](GUIDE.md)** · **[Подробный гайд по установке для новичков — шаг за шагом](GUIDE.md)**

Personal Vencord userplugin: translation that is set up **per chat**, with a translate button on every message. Based on Vencord's built-in Translate plugin (turn that one off).

Личный плагин Vencord: перевод, который настраивается **отдельно для каждого чата**, и кнопка перевода у каждого сообщения. Основан на встроенном плагине Translate (его нужно отключить).

## Features / Возможности

- Auto-translate incoming messages per chat, language of the chat and the target language are set separately / Автоперевод входящих сообщений по чатам, свой язык чата и язык перевода
- Translate your outgoing messages (per chat or for a whole server), originals of your own messages stay visible to you / Перевод своих сообщений перед отправкой (для чата или всего сервера), твои оригиналы остаются на виду
- Edit a message in your own language, it is translated again / Правка сообщения на своём языке с повторным переводом
- Translation of pictures (text on screenshots) and text files / Перевод картинок и текстовых файлов
- Hotkeys (Alt + key), configurable / Горячие клавиши (Alt + клавиша), настраиваются
- Translators: Google (no key), DeepL, Kagi / Переводчики: Google (без ключа), DeepL, Kagi
- Plugin texts: Russian, English; other languages are translated automatically from the language of Discord / Тексты плагина: русский, английский; для остальных языков переводятся автоматически по языку Discord

## Install / Установка

**Links / Ссылки**

- Vencord (zip): https://github.com/Vendicated/Vencord/archive/refs/heads/main.zip
- Vencord repository / репозиторий: https://github.com/Vendicated/Vencord
- Official guide for custom plugins / официальное руководство: https://docs.vencord.dev/installing/custom-plugins/
- Node.js (LTS): https://nodejs.org
- This plugin (zip) / этот плагин (zip): https://github.com/MainardT/TranslatePerChat/archive/refs/heads/main.zip

**Steps / Шаги**

1. Install [Node.js](https://nodejs.org) (LTS), then close and reopen PowerShell. / Установи Node.js (LTS), затем закрой и заново открой PowerShell.
2. Install pnpm / Установи pnpm: `npm install -g pnpm`
3. Download and unpack [Vencord](https://github.com/Vendicated/Vencord/archive/refs/heads/main.zip). / Скачай и распакуй Vencord.
4. Download and unpack [this plugin](https://github.com/MainardT/TranslatePerChat/archive/refs/heads/main.zip). / Скачай и распакуй этот плагин.
5. In the Vencord folder create `src/userplugins/translatePerChat` and put the plugin files in it (`index.tsx`, `settings.tsx` ... must lie directly inside). / В папке Vencord создай `src/userplugins/translatePerChat` и положи туда файлы плагина (`index.tsx`, `settings.tsx` ... прямо в ней).
6. Open PowerShell **in the Vencord root folder** (where `package.json` is, not in `src\plugins`) and run, one command at a time / Открой PowerShell **в корневой папке Vencord** (где лежит `package.json`, не в `src\plugins`) и выполни по одной команде:

```
pnpm install
```

```
$env:VENCORD_HASH="local"; $env:VENCORD_REMOTE="Vendicated/Vencord"; pnpm build
```

Check that `dist/renderer.js` exists, then / Проверь, что появился файл `dist/renderer.js`, потом:

```
pnpm inject
```

(The `$env:` line is needed because Vencord is downloaded as a zip, not through Git. Строка `$env:` нужна, потому что Vencord скачан архивом, а не через Git.)

7. Fully restart Discord. / Полностью перезапусти Discord.
8. Turn on **TranslatePerChat** in Vencord settings (and turn off the built-in **Translate**). / Включи **TranslatePerChat** в настройках Vencord (встроенный **Translate** выключи).

Open the plugin settings for the full list of options; the button above the chat input opens the settings of the current chat.
Полный список настроек — в настройках плагина; кнопка у поля ввода открывает настройки текущего чата.

## Notes / Примечания

- DeepL and Kagi keys are stored in your Discord settings, not in this repository. / Ключи DeepL и Kagi хранятся в настройках Discord, не в репозитории.
- Client mods may go against Discord's Terms of Service; use at your own risk. / Модификации клиента могут нарушать правила Discord, используй на свой риск.

## License / Лицензия

GPL-3.0-or-later, same as Vencord. See `LICENSE`.
