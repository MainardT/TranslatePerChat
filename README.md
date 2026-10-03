# TranslatePerChat — «Переводчик чатов» for Vencord

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

You need Vencord built from source. Two ways to get it:
Нужен Vencord, собранный из исходников. Два способа получить его:

- **Quick / Быстро:** [download Vencord (zip)](https://github.com/Vendicated/Vencord/archive/refs/heads/main.zip) and unpack it. Building needs [Node.js](https://nodejs.org) and pnpm. / [скачать Vencord (zip)](https://github.com/Vendicated/Vencord/archive/refs/heads/main.zip) и распаковать. Для сборки нужны [Node.js](https://nodejs.org) и pnpm.
- **Step by step / По документации:** [official guide](https://docs.vencord.dev/installing/custom-plugins/) / [официальное руководство](https://docs.vencord.dev/installing/custom-plugins/)

1. Copy the contents of this repository into a folder named `translatePerChat` inside `Vencord/src/userplugins/` (the files `index.tsx`, `settings.tsx` ... must lie directly in it) / Скопируй содержимое этого репозитория в папку `translatePerChat` внутри `Vencord/src/userplugins/` (файлы `index.tsx`, `settings.tsx` ... должны лежать прямо в ней)
2. In the Vencord folder run / В папке Vencord выполни: `pnpm build`
3. Inject and fully restart Discord / Установи Vencord в Discord и полностью перезапусти его
4. Turn on **TranslatePerChat** in Vencord settings (and turn off the built-in **Translate**) / Включи **TranslatePerChat** в настройках Vencord (встроенный **Translate** выключи)

Open the plugin settings for the full list of options; the button above the chat input opens the settings of the current chat.
Полный список настроек — в настройках плагина; кнопка у поля ввода открывает настройки текущего чата.

## Notes / Примечания

- DeepL and Kagi keys are stored in your Discord settings, not in this repository. / Ключи DeepL и Kagi хранятся в настройках Discord, не в репозитории.
- Client mods may go against Discord's Terms of Service; use at your own risk. / Модификации клиента могут нарушать правила Discord, используй на свой риск.

## License / Лицензия

GPL-3.0-or-later, same as Vencord. See `LICENSE`.
