// Invented sample data for design mockups. Nothing here comes from the real diary or ideas.
// "Today" is fixed so every screenshot is reproducible.
(() => {
  const TODAY = "2026-11-09";

  const entries = [
    {
      date: "2026-11-07",
      text: [
        "Прокинувся без будильника, і це вже щось. Вийшов, поки не розвиднілося, дійшов до річки й назад: сорок хвилин, без телефона в руках. Місто о такій годині схоже на чернетку, у якій ще нічого не вирішено і все можна почати заново.",
        "Після обіду розібрав стіл. Знайшов блокнот із літа, де половина сторінок — списки справ, які я давно зробив або вже не хочу робити. Виривати не став, просто закрив.",
      ],
    },
    {
      date: "2026-11-01",
      text: [
        "Тиждень, який здавався порожнім, виявився насиченим. Коли сідаю писати, виходить, що я щодня робив щось невелике, але своє: у вівторок полагодив велосипед, у четвер нарешті подзвонив мамі й говорив майже годину, а в суботу пройшов той маршрут уздовж каналу, який відкладав ще з весни.",
        "Помітив, що найкращі дні в мене ті, де є одна річ, зроблена руками. Не проєкт і не лист, а щось, що можна потримати: ланцюг, змащений і натягнутий як слід, чашка, яку я нарешті склеїв. Робота, після якої видно результат, заспокоює сильніше за відпочинок.",
        "Читаю повільно книжку про те, як люди писали щоденники в тяжкі часи. Вражає не драма, а побут: хто що їв, де брав дрова, як лічив дні. Мабуть, колись і мої записи про каву й погоду комусь здадуться найціннішими.",
        "Хочу спробувати до кінця місяця одну просту звичку: записувати лише одне речення за день, навіть коли немає сил на більше. Не щоб було що перечитувати, а щоб день не зливався з наступним.",
        "Увечері довго дивився у вікно. Нічого не придумав, і це теж був хороший вечір.",
      ],
    },
    {
      date: "2026-10-25",
      text: [
        "Зміна часу забрала годину сну й дала годину світла, якого мені чомусь не потрібно. Увесь день пройшов у дрібницях: розбирав пошту, переписував план на листопад, двічі ставив чайник і забував про нього.",
        "Увечері вийшов просто походити районом. Знайшов двір із липою, повз який проїздив сотню разів і ніколи не зупинявся.",
      ],
    },
    {
      date: "2026-10-19",
      text: [
        "Довга розмова з Тарасом про те, чи треба щось доводити людям, яких давно не бачиш. Дійшли до того, що ні. Лишається просто телефонувати.",
      ],
    },
    {
      date: "2026-10-11",
      text: [
        "Перший холодний ранок. Дістав шарф, який тримав із зими, і він ще пахне шафою. Купив яблук на ринку в бабусі біля входу, вона відважила із запасом і сказала берегти себе. Дрібниця, а ходив із цим цілий день.",
      ],
    },
    {
      date: "2026-09-28",
      text: [
        "Дочитав збірку оповідань, яку мені радили ще навесні. Остання історія зайшла найсильніше, і я зрозумів, що почав її занадто пізно ввечері, тому нічого не пам’ятаю про початок. Перечитаю вранці.",
      ],
    },
    {
      date: "2026-09-14",
      text: [
        "Три години в лісі без жодної мети. Грибів не знайшов, зате знайшов тишу, яка тримається ще й дві доби потому.",
      ],
    },
    {
      date: "2026-08-30",
      text: [
        "Переглянув фото за літо. Їх усього сорок, і половина — небо. Мабуть, я справді тільки те й робив, що дивився вгору.",
      ],
    },
    {
      date: "2026-07-12",
      text: [
        "Купив нове сідло для велосипеда й півдня підбирав висоту. Різниця в два міліметри, а їхати зовсім інакше. Так і з багатьма речами: усе вирішують дрібниці, яких не видно збоку.",
      ],
    },
    {
      date: "2026-06-25",
      text: [
        "Їздив за місто, велосипед тримав добре, а от я до вечора втомився більше, ніж очікував. Спав, як після довгої дороги.",
      ],
    },
    {
      date: "2025-11-09",
      text: [
        "Уперше за довгий час нічого не планував на неділю. Спочатку було незвично, потім просто сидів із чаєм і слухав дощ. Хочеться, щоб таких неділь було більше.",
      ],
    },
  ];

  const ideas = [
    { at: "2026-11-09T08:12", text: "Тижневий огляд перенести з п’ятниці на неділю ввечері: п’ятниця вже зайнята думками про вихідні." },
    { at: "2026-11-09T07:40", text: "Спитати Олю про книжку про шрифти, яку вона згадувала." },
    { at: "2026-11-08T22:15", text: "Сфотографувати один і той самий двір у різні пори року." },
    { at: "2026-11-08T13:02", text: "Чому влітку я пишу довше, ніж узимку? Порівняти довжину записів за місяцями." },
    { at: "2026-11-07T09:30", text: "Купити змазку для ланцюга й суху тканину." },
    { at: "2026-11-05T18:44", text: "Спробувати записати підсумок тижня голосовим замість тексту." },
    { at: "2026-11-04T12:10", text: "Маршрут уздовж каналу до мосту. Взяти термос." },
    { at: "2026-11-02T21:03", text: "Одного вечора нічого не планувати й не брати телефон." },
  ];


  const TYPES = { article: "Стаття", podcast: "Подкаст", resource: "Ресурс", game: "Гра", album: "Альбом", video: "Відео", series: "Серіал", book: "Книга" };
  const STATUS = { saved: "На потім", in_progress: "У процесі", consumed: "Ознайомився", finished: "Завершено" };
  const REACTION = { loved: "Улюблене", positive: "Сподобалось", mixed: "Змішані враження", negative: "Не сподобалось" };
  const REACTION_ICON = { loved: "heart", positive: "thumbUp", mixed: "mixed", negative: "thumbDown" };

  // Invented items. Covers are drawn placeholders for the real Open Graph images.
  const media = [
    { id: "m1", type: "article", title: "Повільний дизайн: навіщо інтерфейсам пауза", creator: "Марта Кравець", source: "longreads.example", status: "consumed", on: "2026-11-08", reaction: "positive",
      tags: ["дизайн", "інтерфейси", "повільний дизайн"], summary: "Есей про те, як короткі паузи й тиша в інтерфейсі знижують тривогу та роблять рішення усвідомленішими.",
      thoughts: [{ at: "2026-11-08", text: "Найкраща думка — пауза як частина інтерфейсу, а не вада. Хочу перевірити це на щоденнику: не показувати лічильників і серій." }, { at: "2026-11-09", text: "Повернутися до абзацу про «місце для нічого»." }] },
    { id: "m2", type: "podcast", title: "Епізод 42. Як ми пам’ятаємо", creator: "Довга пам’ять", source: "podcast.example", status: "consumed", on: "2026-11-06", reaction: "loved",
      tags: ["пам’ять", "психологія", "щоденник"], summary: "Розмова з нейробіологинею про те, чому записане запам’ятовується інакше, ніж прожите, і що з цим робити.",
      thoughts: [{ at: "2026-11-06", text: "Те, що я перечитую, я пам’ятаю краще, ніж те, що прожив. Мабуть, тому щоденник працює навіть коли нічого не відбувається." }] },
    { id: "m3", type: "resource", title: "Mobile UI Patterns — галерея мобільних екранів", creator: "", source: "patterns.example", status: null, on: "2026-11-05", reaction: null,
      tags: ["натхнення", "мобільні інтерфейси"], summary: "Бібліотека скриншотів реальних застосунків, згрупованих за сценаріями: онбординг, списки, налаштування.", thoughts: [] },
    { id: "m9", type: "article", title: "Чому нам потрібні нудні вихідні", creator: "Андрій Лозинський", source: "longreads.example", status: "consumed", on: "2026-11-02", reaction: null,
      tags: ["відпочинок", "увага"], summary: "Колонка про те, що нічого не робити — окрема навичка, яку легко втратити.", thoughts: [] },
    { id: "m4", type: "game", title: "Тиха гавань", creator: "Студія «Берег»", source: "harbor.example", status: "in_progress", on: "2026-11-03", reaction: null,
      tags: ["інді", "затишна гра", "будівництво"], summary: "Неспішна гра про відновлення рибальського містечка, без таймерів і втрат.", thoughts: [] },
    { id: "m5", type: "album", title: "Світанок над водою", creator: "Олена Вайс", source: "music.example", status: "consumed", on: "2026-11-01", reaction: "mixed",
      tags: ["амбієнт", "інструментальна", "ранок"], summary: "Амбієнтний альбом із довгими фортепіанними фразами та шумом води.",
      thoughts: [{ at: "2026-11-01", text: "Перші три треки чудові для роботи, далі стає однаково." }] },
    { id: "m6", type: "video", title: "Типографіка для інтерфейсів за 20 хвилин", creator: "Студія «Лінія»", source: "video.example", status: "saved", on: "2026-10-30", reaction: null,
      tags: ["типографіка", "дизайн"], summary: "Огляд міжрядкового інтервалу, довжини рядка та шрифтових пар для застосунків.", thoughts: [] },
    { id: "m7", type: "book", title: "Мова простору", creator: "Ірина Гнатюк", source: "books.example", status: "finished", on: "2026-10-25", reaction: "loved",
      tags: ["архітектура", "нон-фікшн", "місто"], summary: "Книга про те, як будівлі й вулиці розмовляють із людьми без слів.",
      thoughts: [{ at: "2026-10-25", text: "Дочитав. Розділ про двори й сходи — той, до якого я повертатимусь." }] },
    { id: "m8", type: "series", title: "Берег", creator: "", source: "series.example", status: "saved", on: "2026-10-22", reaction: null,
      tags: ["драма", "мінісеріал"], summary: "Мінісеріал про родину, що повертається в рідне містечко на узбережжі.", thoughts: [] },
  ];

  const MONTHS = ["січень","лютий","березень","квітень","травень","червень","липень","серпень","вересень","жовтень","листопад","грудень"];
  const MONTHS_GEN = ["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"];
  const MONTHS_ABBR = ["січ","лют","бер","кві","тра","чер","лип","сер","вер","жов","лис","гру"];
  const WD_SHORT = ["нд","пн","вт","ср","чт","пт","сб"];
  const WD_FULL = ["неділя","понеділок","вівторок","середа","четвер","пʼятниця","субота"];

  const d = (iso) => new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  };
  const records = (n) => `${n} ${plural(n, "запис", "записи", "записів")}`;

  const firstSentence = (text) => {
    const m = text.match(/^.+?[.!?](?=\s|$)/);
    return m ? m[0] : text;
  };
  const restAfterFirst = (text) => text.slice(firstSentence(text).length).trim();
  const clip = (s, n) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n)).replace(/[,;:\s]+$/, "") + "…");
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const mark = (s, q) => {
    const stem = q.toLowerCase();
    return esc(s).replace(new RegExp(`(${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\p{L}’]*)`, "giu"), "<mark>$1</mark>");
  };

  const byMonth = [];
  for (const e of [...entries].sort((a, b) => b.date.localeCompare(a.date))) {
    const k = e.date.slice(0, 7);
    let g = byMonth.find((x) => x.key === k);
    if (!g) byMonth.push((g = { key: k, year: +k.slice(0, 4), month: +k.slice(5) - 1, items: [] }));
    g.items.push(e);
  }

  const ICONS = {
    search: '<path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm10 3-4.9-4.9"/>',
    calendar: '<path d="M7 3v3m10-3v3M4 9h16M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5Z"/>',
    diary: '<path d="M12 6.5C10.3 5.2 8 4.6 4.5 4.8v13c3.5-.2 5.8.4 7.5 1.7m0-13c1.7-1.3 4-1.9 7.5-1.7v13c-3.5-.2-5.8.4-7.5 1.7m0-13v13"/>',
    ideas: '<path d="M9 18.5h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    more: '<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="3"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    chevUp: '<path d="m5 15 7-7 7 7"/>',
    chevDown: '<path d="m5 9 7 7 7-7"/>',
    library: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
    sliders: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9M15 4.5v5M9 14.5v5"/>',
    external: '<path d="M14 4h6v6m0-6-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
    thumbUp: '<path d="M7 10v11M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z"/>',
    thumbDown: '<path d="M17 14V3M9 18.1 10 14H4.2a2 2 0 0 1-1.9-2.6l2.3-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9Z"/>',
    mixed: '<circle cx="12" cy="12" r="9"/><path d="M8.5 15.2h7M9 9.6h.01M15 9.6h.01" stroke-width="2.2"/>',
    clear: '<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"/><path d="m9 9 6 6m0-6-6 6" stroke="var(--clear-x,#fff)"/>',
  };
  const icon = (n, size = 22) =>
    `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

  // Telegram's own chrome above the Mini App (not part of our design): status bar + header.
  const host = ({ back = false } = {}) => `
    <div class="tg-status"><span>9:41</span><span class="tg-status-r"><i></i><i></i><i></i></span></div>
    <div class="tg-head">
      <span class="tg-side">${back ? icon("back", 20) + "Назад" : "Закрити"}</span>
      <span class="tg-title"><b>Media Reflection</b><small>бот</small></span>
      <span class="tg-more">${icon("more", 20)}</span>
    </div>`;

  const phone = (inner, cls = "") => `<div class="phone ${cls}">${inner}<div class="home"></div></div>`;

  const board = (title, note, screens) => `
    <header class="board-head">
      <div><h1>${title}</h1><p>${note}</p></div>
      <div class="theme" role="group" aria-label="Тема">
        <button data-t="light">Світла</button><button data-t="dark">Темна</button>
      </div>
    </header>
    <div class="board">${screens.map(([name, html]) => `<figure><div class="slot">${html}</div><figcaption>${name}</figcaption></figure>`).join("")}</div>`;

  const mount = (target, html) => {
    target.innerHTML = html;
    const set = (t) => {
      document.documentElement.dataset.theme = t;
      target.querySelectorAll(".theme button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.t === t));
    };
    const q = new URLSearchParams(location.search).get("theme");
    set(q === "dark" ? "dark" : "light");
    target.querySelectorAll(".theme button").forEach((b) => b.addEventListener("click", () => set(b.dataset.t)));
  };

  window.MOCK = {
    TODAY, entries, ideas, byMonth, media, TYPES, STATUS, REACTION, REACTION_ICON, MONTHS, MONTHS_GEN, MONTHS_ABBR, WD_SHORT, WD_FULL,
    d, cap, plural, records, firstSentence, restAfterFirst, clip, esc, mark, icon, host, phone, board, mount,
    pad: (n) => String(n).padStart(2, "0"),
    words: (e) => e.text.join(" ").split(/\s+/).length,
    time: (iso) => iso.slice(11, 16),
    dayLabel: (iso) => {
      const day = iso.slice(0, 10);
      if (day === TODAY) return "Сьогодні";
      if (day === "2026-11-08") return "Вчора";
      const x = d(day);
      return `${x.getDate()} ${MONTHS_GEN[x.getMonth()]}`;
    },
  };
})();
