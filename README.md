# TranslatePerChat — «Переводчик чатов» for Vencord

**English** · [Русский](#русский) · **[Installation guide for beginners / Подробный гайд по установке](GUIDE.md)**

---

## English

Personal Vencord userplugin: translation that is set up **per chat**, with a translate button on every message. Based on Vencord's built-in Translate plugin (turn that one off).

### Features

- Auto-translate incoming messages per chat; the language of the chat and the target language are set separately
- Translate your outgoing messages (per chat or for a whole server); originals of your own messages stay visible to you
- Edit a message in your own language, it is translated again
- Translation of pictures (text on screenshots) and text files
- Hotkeys (Alt + key), configurable
- Translators: Google (no key), DeepL, Kagi
- Plugin texts: Russian, English; other languages are translated automatically from the language of Discord

### Install

**Links**

- [Step-by-step guide for beginners](GUIDE.md)
- Vencord (zip): https://github.com/Vendicated/Vencord/archive/refs/heads/main.zip
- Vencord repository: https://github.com/Vendicated/Vencord
- Official guide for custom plugins: https://docs.vencord.dev/installing/custom-plugins/
- Node.js (LTS): https://nodejs.org
- This plugin (zip): https://github.com/MainardT/TranslatePerChat/archive/refs/heads/main.zip

**Steps**

1. Install [Node.js](https://nodejs.org) (LTS), then close and reopen PowerShell.
2. Install pnpm: `npm install -g pnpm`
3. Download and unpack [Vencord](https://github.com/Vendicated/Vencord/archive/refs/heads/main.zip).
4. Download and unpack [this plugin](https://github.com/MainardT/TranslatePerChat/archive/refs/heads/main.zip).
5. In the Vencord folder create `src/userplugins/translatePerChat` and put the plugin files in it (`index.tsx`, `settings.tsx` ... must lie directly inside).
6. Open PowerShell **in the Vencord root folder** (where `package.json` is, not in `src\plugins`) and run, one command at a time:

```
pnpm install
```

```
$env:VENCORD_HASH="local"; $env:VENCORD_REMOTE="Vendicated/Vencord"; pnpm build
```

Check that `dist/renderer.js` exists, then:

```
pnpm inject
```

(The `$env:` line is needed because Vencord is downloaded as a zip, not through Git.)

7. Fully restart Discord.
8. Turn on **TranslatePerChat** in Vencord settings (and turn off the built-in **Translate**).

Open the plugin settings for the full list of options; the button above the chat input opens the settings of the current chat.

### Notes

- DeepL and Kagi keys are stored in your Discord settings, not in this repository.
- Client mods may go against Discord's Terms of Service; use at your own risk.

### License

GPL-3.0-or-later, same as Vencord. See `LICENSE`.

---

## Русский

[English](#english) · **Русский** · **[Подробный гайд по установке](GUIDE.md)**

Личный плагин Vencord: перевод, который настраивается **отдельно для каждого чата**, и кнопка перевода у каждого сообщения. Основан на встроенном плагине Translate (его нужно отключить).

### Возможности

- Автоперевод входящих сообщений по чатам; свой язык чата и язык перевода
- Перевод своих сообщений перед отправкой (для чата или всего сервера); твои оригиналы остаются на виду
- Правка сообщения на своём языке с повторным переводом
- Перевод картинок (текст на скриншотах) и текстовых файлов
- Горячие клавиши (Alt + клавиша), настраиваются
- Переводчики: Google (без ключа), DeepL, Kagi
- Тексты плагина: русский, английский; для остальных языков переводятся автоматически по языку Discord

### Установка

**Ссылки**

- [Подробный гайд для новичков](GUIDE.md)
- Vencord (zip): https://github.com/Vendicated/Vencord/archive/refs/heads/main.zip
- Репозиторий Vencord: https://github.com/Vendicated/Vencord
- Официальное руководство по своим плагинам: https://docs.vencord.dev/installing/custom-plugins/
- Node.js (LTS): https://nodejs.org
- Этот плагин (zip): https://github.com/MainardT/TranslatePerChat/archive/refs/heads/main.zip

**Шаги**

1. Установи [Node.js](https://nodejs.org) (LTS), затем закрой и заново открой PowerShell.
2. Установи pnpm: `npm install -g pnpm`
3. Скачай и распакуй [Vencord](https://github.com/Vendicated/Vencord/archive/refs/heads/main.zip).
4. Скачай и распакуй [этот плагин](https://github.com/MainardT/TranslatePerChat/archive/refs/heads/main.zip).
5. В папке Vencord создай `src/userplugins/translatePerChat` и положи туда файлы плагина (`index.tsx`, `settings.tsx` ... прямо в ней).
6. Открой PowerShell **в корневой папке Vencord** (где лежит `package.json`, не в `src\plugins`) и выполни по одной команде:

```
pnpm install
```

```
$env:VENCORD_HASH="local"; $env:VENCORD_REMOTE="Vendicated/Vencord"; pnpm build
```

Проверь, что появился файл `dist/renderer.js`, потом:

```
pnpm inject
```

(Строка `$env:` нужна, потому что Vencord скачан архивом, а не через Git.)

7. Полностью перезапусти Discord.
8. Включи **TranslatePerChat** в настройках Vencord (встроенный **Translate** выключи).

Полный список настроек — в настройках плагина; кнопка у поля ввода открывает настройки текущего чата.

### Примечания

- Ключи DeepL и Kagi хранятся в настройках Discord, не в репозитории.
- Модификации клиента могут нарушать правила Discord, используй на свой риск.

### Лицензия

GPL-3.0-or-later, как и Vencord. Подробности — в файле `LICENSE`.
