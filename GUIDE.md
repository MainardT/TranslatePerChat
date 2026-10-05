# Установка плагина TranslatePerChat — для самых ленивых / Install guide for the laziest

[English](#english) · [Русский](#русский)

---

## English

This is for Windows. You do not need to understand anything: just do the steps in order. **Do not skip any.**

**Main rule:** paste commands **one at a time** (or as one line where it says so), press **Enter** after each and wait for a new line `PS C:\...>`.

### Step 1. Install Node.js (needed for everything else)

1. Open **https://nodejs.org**
2. Click the big top button under the text: **Get Node.js®**. Do not click the lower button (**Get security support for EOL Node.js versions**).
3. On the next page choose the version marked **LTS** (for example `v24.… LTS`), choose **Windows** in the "for" field and download the installer: the **Windows Installer (.msi)** button.
4. Open the file. Click **Next → Next → Next → Install → Finish**. Do not change anything.

### Step 2. Open the "black window" (this is where commands go)

1. Press the **Windows** key.
2. Type **PowerShell**.
3. Choose **Windows PowerShell** (without "x86") and press **Enter**. A dark window opens.

**How to paste a command:** copy it from here (select → Ctrl+C), **right-click** in the dark window (it pastes) and press **Enter**.

**If you see `>>` at the bottom:** the window is waiting for more input. Press **Ctrl+C** and paste the command again.

**Check Node.js:** paste `node -v`. It must show a version (for example `v24.21.0`). If it says "not recognized": Node.js is not installed (repeat step 1) or this window was opened before the installation (close it and open a new one).

### Step 3. Allow scripts (once)

Paste and press Enter:

```
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

If it asks for confirmation, press **Y** and Enter. If it asks nothing and a new line appears, that is fine. Type `Y` only as an answer to this question.

### Step 4. Install pnpm

Paste and press Enter:

```
npm install -g pnpm
```

Wait for a new line. Check: `pnpm -v` must show a version.

> If you see red `ECONNRESET` or `network`: it is an internet problem or a block. Try: again, turn VPN on or off, or use the mirror:
> `npm install -g pnpm --registry=https://registry.npmmirror.com`
>
> Ignore yellow `warn` lines. If `pnpm -v` still does not work, paste:
> `npm install -g --allow-scripts=pnpm pnpm --registry=https://registry.npmmirror.com`

### Step 5. Download Vencord

1. Click: **https://github.com/Vendicated/Vencord/archive/refs/heads/main.zip**
2. You get `Vencord-main.zip`. **Right-click → Extract All → Extract.**
3. You get a folder **Vencord-main**. Move it to drive **C:** (so the path is short: `C:\Vencord-main`).

### Step 6. Download this plugin

1. Click: **https://github.com/MainardT/TranslatePerChat/archive/refs/heads/main.zip**
2. You get `TranslatePerChat-main.zip`. **Right-click → Extract All → Extract.**
3. Open the folder `TranslatePerChat-main`: inside are files (`index.tsx`, `settings.tsx` and others). Press **Ctrl+A** (select all) and **Ctrl+C** (copy).

### Step 7. Put the plugin into Vencord

1. Open `C:\Vencord-main\src`.
2. Create a folder **userplugins** (right-click → New → Folder). If it exists, just open it.
3. Inside `userplugins` create a folder **translatePerChat** (exactly like this, small `t` at the start).
4. Open it and press **Ctrl+V** (paste the files).

Check: `C:\Vencord-main\src\userplugins\translatePerChat` must contain the file **index.tsx** directly (not another folder).

### Step 8. Open the dark window in the Vencord folder

1. Open the folder `C:\Vencord-main` (the one with the file `package.json`).
2. Click the **address bar** at the top of the window (where the path is), erase it, type **powershell** and press **Enter**. A dark window opens in the right folder (the line shows `PS C:\Vencord-main>`).

### Step 9. Install Vencord's files

Paste and press Enter. It takes a few minutes; wait for a new line `PS C:\Vencord-main>`:

```
pnpm install
```

> On `ECONNRESET`: repeat, turn VPN on or off, or paste `pnpm install --registry=https://registry.npmmirror.com`.
> Yellow `WARN` lines are normal.

### Step 10. Build Vencord

Paste **as one line** (the whole thing) and press Enter. Wait for a new line:

```
$env:VENCORD_HASH="local"; $env:VENCORD_REMOTE="Vendicated/Vencord"; pnpm build
```

(This line is needed because Vencord was downloaded as a zip, not through Git. Paste it **every time** you rebuild, not just `pnpm build`.)

**Mandatory check:** open the folder `C:\Vencord-main\dist`. It must contain the file **renderer.js** (about 870 KB). If it is not there, do NOT continue: the build failed. Send a screenshot of the last lines of the dark window to the author.

### Step 11. Install Vencord into Discord

1. Close Discord completely (icon near the clock at the bottom right → right-click → **Quit**).
2. In the same dark window paste and press Enter:

```
pnpm inject
```

3. If a menu appears, use the arrow keys to select your Discord (usually "Discord Stable") and press **Enter**. At the end you should see `Successfully patched` and `Success!`.

### Step 12. Turn the plugin on

1. Start Discord.
2. Go to **Settings (gear) → Vencord → Plugins**.
3. Search **TranslatePerChat** and turn it on.
4. Find the built-in plugin **Translate** and turn it **off**.
5. Restart Discord. Done.

### If something went wrong

| What you see | What to do |
|---|---|
| `node`, `npm` or `pnpm` "not recognized" | Close the dark window and open a new one. If it does not help, repeat step 1 (Node.js) or step 4 (pnpm). |
| Red text about "scripts disabled" | Step 3. |
| `>>` at the bottom | Ctrl+C and paste the command again. |
| `ECONNRESET` or `network` | Internet problem: retry, VPN, mirror (see steps 4 and 9). |
| `Cannot find package.json` | The dark window is in the wrong folder. Repeat step 8. |
| No `renderer.js` in `dist` | The build failed. Do not run `pnpm inject`. Send a screenshot to the author. |
| After `pnpm inject` Discord shows an error about `dist\...js` | Paste `pnpm uninject` (restores Discord), then rebuild (step 10). |
| The plugin is not in the list | `translatePerChat` contains another folder instead of files. Move the files one level up and repeat step 10. |
| Anything else | Take a screenshot of the dark window and send it to the author. |

### How to update the plugin later

Download the plugin again (step 6), paste the files into `translatePerChat` and replace, open the dark window in the Vencord folder (step 8), paste the whole line from step 10, wait for the end and restart Discord.

### How to remove Vencord

In the dark window in the Vencord folder: `pnpm uninject`.

> Client mods may go against Discord's Terms of Service. Use at your own risk.

---

## Русский

Всё делается на Windows. Ничего не нужно понимать, просто повторяй шаги по порядку. **Не пропускай шаги.**

**Главное правило:** команды вставляй **по одной** (или одной строкой, если так написано), после каждой жми **Enter** и жди, пока не появится новая строка `PS C:\...>`.

### Шаг 1. Поставь Node.js (программа, без неё ничего не заработает)

1. Открой сайт **https://nodejs.org**
2. Нажми самую верхнюю большую кнопку под текстом: **Get Node.js®**. Нижнюю кнопку (**Get security support for EOL Node.js versions**) не нажимай.
3. На новой странице выбери версию с пометкой **LTS** (например, `v24.… LTS`), в поле «for» выбери **Windows** и скачай установщик: кнопка **Windows Installer (.msi)**.
4. Открой скачанный файл. Жми **Next → Next → Next → Install → Finish**. Больше ничего менять не надо.

### Шаг 2. Открой «чёрное окно» (сюда вставляются команды)

1. Нажми клавишу **Windows** на клавиатуре.
2. Напиши **PowerShell**.
3. Выбери **Windows PowerShell** (без пометки x86) и нажми **Enter**. Откроется тёмное окно. Это и есть место для команд.

**Как вставлять команды:** скопируй команду отсюда (выдели → Ctrl+C), в тёмном окне нажми **правой кнопкой мыши** (команда вставится) и нажми **Enter**.

**Если внизу появилась строка `>>`:** окно ждёт продолжения. Нажми **Ctrl+C** и вставь команду заново.

**Проверка Node.js:** вставь `node -v`. Должен показать номер версии (например, `v24.21.0`). Если пишет «не распознано» — Node.js не установился (повтори шаг 1) или это окно было открыто до установки (закрой его и открой новое).

### Шаг 3. Разреши запуск скриптов (один раз)

Вставь и нажми Enter:

```
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Если спросит подтверждение — нажми **Y** и Enter. Если ничего не спросило и появилась новая строка, это тоже нормально. Букву `Y` вводи только в ответ на этот вопрос.

### Шаг 4. Поставь pnpm

Вставь и нажми Enter:

```
npm install -g pnpm
```

Подожди новую строку. Проверка: `pnpm -v` должен показать версию.

> Если красным написало `ECONNRESET` или `network` — это сбой интернета или блокировка. Попробуй: ещё раз, включить или выключить VPN, или вставь вариант через зеркало:
> `npm install -g pnpm --registry=https://registry.npmmirror.com`
>
> Жёлтые строки `warn` игнорируй. Если `pnpm -v` не работает после этого, вставь:
> `npm install -g --allow-scripts=pnpm pnpm --registry=https://registry.npmmirror.com`

### Шаг 5. Скачай Vencord

1. Нажми на ссылку: **https://github.com/Vendicated/Vencord/archive/refs/heads/main.zip**
2. Скачается файл `Vencord-main.zip`. Нажми на него **правой кнопкой → Извлечь всё → Извлечь**.
3. Получится папка **Vencord-main**. Перенеси её на диск **C:** (чтобы путь был коротким: `C:\Vencord-main`).

### Шаг 6. Скачай этот плагин

1. Нажми на ссылку: **https://github.com/MainardT/TranslatePerChat/archive/refs/heads/main.zip**
2. Скачается `TranslatePerChat-main.zip`. **Правой кнопкой → Извлечь всё → Извлечь.**
3. Открой получившуюся папку `TranslatePerChat-main` — внутри будут файлы (`index.tsx`, `settings.tsx` и другие). Нажми **Ctrl+A** (выделить всё) и **Ctrl+C** (скопировать).

### Шаг 7. Положи плагин в Vencord

1. Открой `C:\Vencord-main\src`.
2. Создай там папку **userplugins** (правая кнопка → Создать → Папку). Если такая уже есть — просто открой её.
3. Внутри `userplugins` создай папку **translatePerChat** (ровно так, с маленькой `t` в начале).
4. Открой её и нажми **Ctrl+V** (вставить файлы).

Проверка: в `C:\Vencord-main\src\userplugins\translatePerChat` должен лежать файл **index.tsx** (а не ещё одна папка).

### Шаг 8. Открой тёмное окно в папке Vencord

1. Открой папку `C:\Vencord-main` (где лежит файл `package.json`).
2. Нажми на **строку адреса** вверху окна (где написан путь), сотри всё, напиши **powershell** и нажми **Enter**. Откроется тёмное окно сразу в нужной папке (в строке будет `PS C:\Vencord-main>`).

### Шаг 9. Установи файлы Vencord

Вставь и нажми Enter. Это долго (несколько минут), жди новую строку `PS C:\Vencord-main>`:

```
pnpm install
```

> При `ECONNRESET`: повтори, включи или выключи VPN, или вставь `pnpm install --registry=https://registry.npmmirror.com`.
> Жёлтые строки `WARN` — норма.

### Шаг 10. Собери Vencord

Вставь **одной строкой** (целиком) и нажми Enter. Подожди новую строку:

```
$env:VENCORD_HASH="local"; $env:VENCORD_REMOTE="Vendicated/Vencord"; pnpm build
```

(Эта строка нужна, потому что Vencord скачан архивом, а не через Git. Её надо вставлять **каждый раз**, когда собираешь заново, а не просто `pnpm build`.)

**Обязательная проверка:** открой папку `C:\Vencord-main\dist`. Там должен лежать файл **renderer.js** (около 870 КБ). Если его нет — дальше НЕ идти, сборка не удалась. Пришли скриншот последних строк тёмного окна автору.

### Шаг 11. Установи Vencord в Discord

1. Закрой Discord полностью (значок в правом нижнем углу рядом с часами → правая кнопка → **Выйти/Quit**).
2. В том же тёмном окне вставь и нажми Enter:

```
pnpm inject
```

3. Если появится меню, стрелками выбери свой Discord (обычно «Discord Stable») и нажми **Enter**. В конце должно быть `Successfully patched` и `Success!`.

### Шаг 12. Включи плагин

1. Запусти Discord.
2. Зайди в **Настройки (шестерёнка) → Vencord → Plugins (Плагины)**.
3. В поиске напиши **TranslatePerChat** и включи переключатель.
4. Там же найди плагин **Translate** (встроенный) и **выключи** его.
5. Перезапусти Discord. Готово.

### Если что-то не получилось

| Что написало | Что делать |
|---|---|
| `node` или `npm` или `pnpm` «не распознано» | Закрой тёмное окно и открой новое. Если не помогло — повтори шаг 1 (Node.js) или шаг 4 (pnpm). |
| Красным про «выполнение сценариев отключено» | Шаг 3. |
| Внизу `>>` | Ctrl+C и вставь команду заново. |
| `ECONNRESET` или `network` | Сбой интернета: повтор, VPN, зеркало (см. шаг 4 и 9). |
| `Cannot find package.json` | Тёмное окно открыто не в той папке. Повтори шаг 8. |
| В `dist` нет `renderer.js` | Сборка не удалась. Не делай `pnpm inject`. Пришли скриншот автору. |
| После `pnpm inject` Discord не открывается с ошибкой про `dist\...js` | Вставь `pnpm uninject` (вернёт Discord как был), потом пересобери (шаг 10). |
| Плагина нет в списке | В `translatePerChat` лежит ещё одна папка вместо файлов. Вытащи файлы на уровень выше и повтори шаг 10. |
| Что-то непонятное | Сделай скриншот тёмного окна и отправь автору. |

### Как обновить плагин потом

Скачай плагин заново (шаг 6), вставь файлы в `translatePerChat` с заменой, открой тёмное окно в папке Vencord (шаг 8), вставь строку из шага 10 (целиком), дождись конца и перезапусти Discord.

### Как убрать Vencord

В тёмном окне в папке Vencord: `pnpm uninject`.

> Модификации клиента Discord могут нарушать его правила. Используешь на свой страх и риск.
