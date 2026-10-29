// Точка входа UI «Сосновый берег».
// Рендерит список, схему, карточку и брони; обрабатывает выбор дома кликом
// по списку и схеме, фильтрацию по числу гостей и максимальной цене
// и сброс фильтров кнопкой «Сбросить фильтры». Если смена фильтров скрыла
// выбранный дом, выбор сбрасывается с уведомлением (T-21). При активных
// фильтрах с пустым результатом показывает общую подсказку #filters-empty (T-22).
// В карточке выбранного дома живёт форма бронирования с полями гостей
// и ночей (T-24), живым пересчётом итоговой суммы при вводе (T-25)
// и валидацией значений с сообщениями об ошибках рядом с полями (T-26).
// Кнопка «Подтвердить бронь» создаёт одну запись брони и показывает её
// в списке броней (T-27); двойной клик и повторный вызов confirmBooking
// не создают дубликат записи (T-28). Раздел «Мои брони» рендерит записи
// карточками с датой создания, деталями и суммой, новые сверху (T-30);
// кнопка «Отменить» в карточке одним нажатием удаляет бронь через
// делегированный обработчик на #bookings-list и освобождает дом в списке
// и на схеме (T-31). Брони сохраняются в localStorage под одним ключом
// после создания и отмены; если браузер запретил хранение, уведомление
// заменяется предупреждением, что бронь не переживёт обновление (T-32).
// При загрузке страницы брони восстанавливаются из localStorage
// (restoreBookings, T-33): занятость домов подхватывается через isOccupied,
// bookingSeq поднимается до максимального восстановленного номера, чтобы
// нумерация продолжалась; повреждённые данные сбрасываются с уведомлением
// (ключ перезаписывается валидным пустым состоянием), недоступное хранилище
// сообщается предупреждением. Структурно валидные записи дополнительно
// проходят семантическую чистку (sanitizeRestoredBookings, T-34): отбрасываются
// брони неизвестных домов, дубликаты по id/houseId и записи с неположительными
// или нецелыми guests/nights/total; если хоть одна запись отброшена, показывается
// уведомление, а хранилище перезаписывается очищенным массивом.
// Фильтры и выбранный дом не восстанавливаются.
// Кнопка «Сбросить демо» в разделе «Мои брони» (T-35, setupResetDemo): только
// после подтверждения window.confirm очищает брони, выбор и фильтры (включая
// значения полей фильтров в DOM), начинает нумерацию броней заново
// (bookingSeq = 0) и удаляет из localStorage только ключ приложения
// STORAGE_KEY — removeItem в try/catch, запрет хранения не ломает страницу,
// при исключении показывается дополнительное предупреждение;
// localStorage.clear() намеренно не используется. Изначально занятые дома
// (occupied: true в data.js) сбросом не освобождаются — это данные посёлка.
// Клавиатурная доступность (T-38): кнопки домов несут aria-pressed (выбранный
// дом — "true", остальные свободные — "false", у занятых атрибута нет), поля
// формы брони связаны со своими ошибками через aria-describedby; фокус с
// клавиатуры виден по единому CSS-контуру :focus-visible.

import { HOUSES, getHouseById } from './data.js';
import {
  state,
  STORAGE_KEY,
  getSelectedHouse,
  getFilteredHouses,
  isOccupied,
  isSelected,
  selectHouse,
  clearSelection,
  setFilters,
  resetFilters,
  addBooking,
  findBookingByHouse,
  removeBooking,
  saveBookings,
  loadBookings,
} from './store.js';

// Ссылки на контейнеры, заполняются в bootstrap().
const elements = {};

const CONTAINER_IDS = [
  'filters',
  'filters-empty',
  'selection-notice',
  'scheme',
  'card',
  'house-list',
  'bookings-list',
  'reset-demo',
];

// markSelected=false — для карточки: там дом уже развёрнут как выбранный,
// поэтому бейдж показывает занятость («Свободен»/«Занят»), а не факт выбора.
function statusBadge(house, { markSelected = true } = {}) {
  const badge = document.createElement('span');

  if (isOccupied(house)) {
    badge.className = 'badge badge--occupied';
    badge.textContent = 'Занят';
  } else if (markSelected && isSelected(house)) {
    badge.className = 'badge badge--selected';
    badge.textContent = 'Выбран';
  } else {
    badge.className = 'badge badge--free';
    badge.textContent = 'Свободен';
  }

  return badge;
}

function statusClassName(house, base) {
  if (isOccupied(house)) return `${base} ${base}--occupied`;
  if (isSelected(house)) return `${base} ${base}--selected`;
  return base;
}

// Атрибуты статуса кнопки дома (одинаково в списке и на схеме):
// - aria-disabled вместо disabled: клик должен доходить до обработчика,
//   чтобы показать сообщение о занятости;
// - aria-pressed у свободных кнопок (T-38): "true" у выбранного дома,
//   "false" у остальных — кнопка работает как переключатель «выбран/нет»;
//   у занятых кнопок aria-pressed нет: они не переключатели, их состояние
//   описывает aria-disabled;
// - title — подсказка при наведении и фокусе;
// - data-status — машинная пометка статуса для тестов и будущих стилей.
function applyStatusAttributes(button, house) {
  if (isOccupied(house)) {
    button.dataset.status = 'occupied';
    button.setAttribute('aria-disabled', 'true');
    // Кнопки пересоздаются при каждом рендере, поэтому атрибута на занятой
    // кнопке и так нет; removeAttribute — на случай повторного использования.
    button.removeAttribute('aria-pressed');
    button.setAttribute('title', 'Дом занят — выберите свободный');
    return;
  }

  const selected = isSelected(house);
  button.dataset.status = selected ? 'selected' : 'free';
  button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  button.setAttribute('title', `Выбрать дом „${house.name}“`);
}

function renderHouseList() {
  const container = elements['house-list'];
  if (!container) return;

  const houses = getFilteredHouses(HOUSES);

  if (houses.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'house-list__empty';
    empty.textContent = 'По текущим фильтрам домов нет';
    container.replaceChildren(empty);
    return;
  }

  const items = houses.map((house) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = statusClassName(house, 'house-item');
    button.dataset.houseId = house.id;
    applyStatusAttributes(button, house);

    const name = document.createElement('span');
    name.className = 'house-item__name';
    name.textContent = house.name;

    const meta = document.createElement('span');
    meta.className = 'house-item__meta';
    meta.textContent = `до ${house.capacity} гостей · ${house.pricePerNight} ₽/ночь`;

    button.append(name, statusBadge(house), meta);
    return button;
  });

  container.replaceChildren(...items);
}

// Позиции декоративных деревьев (x, y в процентах), подобраны в свободных
// местах схемы, чтобы не перекрывать кнопки домов из data.js.
const SCHEME_TREES = [
  [8, 7],
  [28, 8],
  [64, 7],
  [90, 9],
  [46, 58],
];

function renderScheme() {
  const container = elements.scheme;
  if (!container) return;

  const decor = document.createElement('div');
  decor.className = 'scheme__decor';
  decor.setAttribute('aria-hidden', 'true');

  const road = document.createElement('div');
  road.className = 'scheme__road';

  const lake = document.createElement('div');
  lake.className = 'scheme__lake';

  const trees = SCHEME_TREES.map(([x, y]) => {
    const tree = document.createElement('div');
    tree.className = 'scheme__tree';
    tree.style.left = x + '%';
    tree.style.top = y + '%';
    return tree;
  });

  const captionRoad = document.createElement('span');
  captionRoad.className = 'scheme__caption-road';
  captionRoad.textContent = 'дорога';

  const captionLake = document.createElement('span');
  captionLake.className = 'scheme__caption-lake';
  captionLake.textContent = 'озеро';

  decor.append(road, lake, ...trees, captionRoad, captionLake);

  const houses = getFilteredHouses(HOUSES).map((house) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = statusClassName(house, 'scheme-house');
    button.dataset.houseId = house.id;
    button.style.left = house.x + '%';
    button.style.top = house.y + '%';
    applyStatusAttributes(button, house);

    const icon = document.createElement('span');
    icon.className = 'scheme-house__icon';
    icon.textContent = '🏠';

    const label = document.createElement('span');
    label.className = 'scheme-house__label';
    label.textContent = house.name;

    button.append(icon, label, statusBadge(house));
    return button;
  });

  // Пустой результат фильтрации: схема не молчит, как и список (T-20).
  if (houses.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'scheme__empty';
    empty.textContent = 'Нет домов по текущим фильтрам';
    container.replaceChildren(decor, empty);
  } else {
    container.replaceChildren(decor, ...houses);
  }
  renderSchemeLegend(container);
}

// Легенда статусов под схемой: живёт в .scheme-wrap после #scheme,
// при повторных рендерах заменяется, а не дублируется.
function renderSchemeLegend(container) {
  const wrap = container.parentElement;
  if (!wrap) return;

  let legend = wrap.querySelector('.scheme-legend');
  if (!legend) {
    legend = document.createElement('div');
    legend.className = 'scheme-legend';
    wrap.appendChild(legend);
  }

  const title = document.createElement('span');
  title.className = 'scheme-legend__title';
  title.textContent = 'Легенда:';

  const items = [
    ['badge--free', 'Свободен'],
    ['badge--selected', 'Выбран'],
    ['badge--occupied', 'Занят'],
  ].map(([modifier, text]) => {
    const item = document.createElement('span');
    item.className = 'scheme-legend__item';

    const badge = document.createElement('span');
    badge.className = `badge ${modifier}`;
    badge.textContent = text;

    item.append(badge);
    return item;
  });

  legend.replaceChildren(title, ...items);
}

// Цена с разделителем тысяч по ru-RU (например, «4 500 ₽»).
function formatPrice(n) {
  return `${n.toLocaleString('ru-RU')} ₽`;
}

// Склонение существительных по числу (русские формы):
// plural(1, ['ночь', 'ночи', 'ночей']) → 'ночь', plural(3, ...) → 'ночи',
// plural(5, ...) → 'ночей'.
function plural(n, [one, few, many]) {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

// Карточка выбранного дома (T-23). Без выбора — заголовок и приглушённая
// заглушка; с выбором — название, бейдж занятости, описание, факты
// (вместимость и цена) и #booking-form-slot, наполняемый формой
// бронирования через renderBookingForm() (T-24; слот существует только
// в выбранном состоянии).
function renderCard() {
  const container = elements.card;
  if (!container) return;

  const house = getSelectedHouse(HOUSES);

  if (!house) {
    const title = document.createElement('h2');
    title.textContent = 'Выбранный дом';

    const placeholder = document.createElement('p');
    placeholder.className = 'card__placeholder';
    placeholder.textContent = 'Выберите свободный дом на схеме или в списке';

    container.replaceChildren(title, placeholder);
    return;
  }

  const title = document.createElement('h2');
  title.className = 'card__title';
  title.textContent = house.name;

  const description = document.createElement('p');
  description.className = 'card__description';
  description.textContent = house.description;

  const facts = document.createElement('ul');
  facts.className = 'card__facts';

  const capacity = document.createElement('li');
  capacity.textContent = `Вместимость: до ${house.capacity} гостей`;

  const price = document.createElement('li');
  price.textContent = `Цена: ${formatPrice(house.pricePerNight)} за ночь`;

  facts.append(capacity, price);

  const formSlot = document.createElement('div');
  formSlot.id = 'booking-form-slot';

  container.replaceChildren(
    title,
    statusBadge(house, { markSelected: false }),
    description,
    facts,
    formSlot,
  );

  renderBookingForm(container, house);
}

// Живой расчёт итога (T-25): итог = цена за ночь × число ночей; гости на
// сумму не влияют, но валидное число гостей обязательно для расчёта.
// Значения читаются из DOM в момент вызова, потому что форма пересоздаётся
// при каждом renderCard. Сумма считается, только когда оба значения —
// целые числа в своих диапазонах (ночи 1..30, гости 1..capacity); иначе
// показывается «—», а причину подсвечивает валидация T-26
// (validateBookingForm + showBookingErrors), здесь просто не считаем.
function updateBookingTotal(house) {
  const nightsInput = document.getElementById('booking-nights');
  const guestsInput = document.getElementById('booking-guests');
  const totalValue = document.getElementById('booking-total-value');
  if (!nightsInput || !guestsInput || !totalValue) return;

  const nights = Number(nightsInput.value);
  const guests = Number(guestsInput.value);

  const nightsValid = Number.isInteger(nights) && nights >= 1 && nights <= 30;
  const guestsValid =
    Number.isInteger(guests) && guests >= 1 && guests <= house.capacity;

  totalValue.textContent = nightsValid && guestsValid
    ? formatPrice(house.pricePerNight * nights)
    : '—';
}

// Валидация значений формы бронирования (T-26). Читает поля из DOM в момент
// вызова (форма пересоздаётся при каждом renderCard) и возвращает объект
// { guests, nights, valid, errors }: guests/nights — целые числа при
// корректном вводе, иначе null; errors — тексты сообщений для показа рядом
// с полями (null, если поле валидно); valid — true, когда ошибок нет.
// Правила: ночи — целое 1..30, гости — целое 1..capacity дома.
// Экспортирована для тестов; ту же функцию при клике использует кнопка
// подтверждения (T-27).
export function validateBookingForm(house) {
  const guestsInput = document.getElementById('booking-guests');
  const nightsInput = document.getElementById('booking-nights');

  // Пустая строка — отдельный случай: Number('') === 0, а нужно сообщение
  // «укажите целое число», поэтому пустоту переводим в NaN явно.
  const guestsRaw = guestsInput?.value.trim() ?? '';
  const nightsRaw = nightsInput?.value.trim() ?? '';
  const guests = guestsRaw === '' ? NaN : Number(guestsRaw);
  const nights = nightsRaw === '' ? NaN : Number(nightsRaw);

  const errors = { guests: null, nights: null };

  if (!Number.isInteger(guests)) {
    errors.guests = 'Укажите целое число гостей';
  } else if (guests < 1) {
    errors.guests = 'Минимум 1 гость';
  } else if (guests > house.capacity) {
    errors.guests = `Дом вмещает не больше ${house.capacity}`;
  }

  if (!Number.isInteger(nights)) {
    errors.nights = 'Укажите целое число ночей';
  } else if (nights < 1) {
    errors.nights = 'Минимум 1 ночь';
  } else if (nights > 30) {
    errors.nights = 'Не больше 30 ночей';
  }

  return {
    guests: errors.guests === null ? guests : null,
    nights: errors.nights === null ? nights : null,
    valid: errors.guests === null && errors.nights === null,
    errors,
  };
}

// Показ ошибок валидации рядом с полями (T-26): текст уходит в контейнер
// .field-error сразу после поля (пустая строка при null — контейнер
// прячется правилом .field-error:empty), а само поле получает или теряет
// атрибут aria-invalid, которым CSS подсвечивает рамку.
function showBookingErrors(errors) {
  const guestsInput = document.getElementById('booking-guests');
  const nightsInput = document.getElementById('booking-nights');
  const guestsError = document.getElementById('booking-guests-error');
  const nightsError = document.getElementById('booking-nights-error');

  if (guestsError) guestsError.textContent = errors.guests ?? '';
  if (nightsError) nightsError.textContent = errors.nights ?? '';

  if (guestsInput) {
    if (errors.guests) {
      guestsInput.setAttribute('aria-invalid', 'true');
    } else {
      guestsInput.removeAttribute('aria-invalid');
    }
  }

  if (nightsInput) {
    if (errors.nights) {
      nightsInput.setAttribute('aria-invalid', 'true');
    } else {
      nightsInput.removeAttribute('aria-invalid');
    }
  }
}

// Форма бронирования внутри карточки (T-24): поля гостей (1..capacity
// выбранного дома) и ночей (1..30), контейнеры ошибок сразу после каждого
// поля (заполняет валидация T-26 при вводе; до первого ввода они пусты),
// строка итога, которую при каждом вводе пересчитывает
// updateBookingTotal() (T-25), и кнопка «Подтвердить бронь»: сабмит
// глушится preventDefault и уходит в confirmBooking() (T-27).
// Форма создаётся заново при каждом renderCard, поэтому слушатели submit
// и input вешаются на форму и поля при создании: preventDefault не даёт
// Enter в полях перезагрузить страницу.
function renderBookingForm(card, house) {
  const slot = card.querySelector('#booking-form-slot');
  if (!slot) return;

  const form = document.createElement('form');
  form.id = 'booking-form';
  form.className = 'booking-form';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    confirmBooking(house);
  });

  const guestsLabel = document.createElement('label');
  guestsLabel.setAttribute('for', 'booking-guests');
  guestsLabel.textContent = `Число гостей (до ${house.capacity})`;

  const guestsInput = document.createElement('input');
  guestsInput.id = 'booking-guests';
  guestsInput.setAttribute('name', 'guests');
  guestsInput.setAttribute('type', 'number');
  guestsInput.setAttribute('min', '1');
  guestsInput.setAttribute('max', String(house.capacity));
  guestsInput.setAttribute('step', '1');
  guestsInput.setAttribute('value', '1');
  guestsInput.setAttribute('required', '');
  // T-38: поле связано со своим контейнером ошибки — скринридер зачитывает
  // сообщение валидации как описание поля.
  guestsInput.setAttribute('aria-describedby', 'booking-guests-error');

  const guestsError = document.createElement('p');
  guestsError.id = 'booking-guests-error';
  guestsError.className = 'field-error';
  guestsError.setAttribute('role', 'alert');

  const nightsLabel = document.createElement('label');
  nightsLabel.setAttribute('for', 'booking-nights');
  nightsLabel.textContent = 'Число ночей (1–30)';

  const nightsInput = document.createElement('input');
  nightsInput.id = 'booking-nights';
  nightsInput.setAttribute('name', 'nights');
  nightsInput.setAttribute('type', 'number');
  nightsInput.setAttribute('min', '1');
  nightsInput.setAttribute('max', '30');
  nightsInput.setAttribute('step', '1');
  nightsInput.setAttribute('value', '1');
  nightsInput.setAttribute('required', '');
  nightsInput.setAttribute('aria-describedby', 'booking-nights-error');

  const nightsError = document.createElement('p');
  nightsError.id = 'booking-nights-error';
  nightsError.className = 'field-error';
  nightsError.setAttribute('role', 'alert');

  const total = document.createElement('p');
  total.className = 'booking-total';
  // Строка итога — живая область: скринридер зачитывает новую сумму
  // при каждом пересчёте (T-25).
  total.setAttribute('aria-live', 'polite');
  total.textContent = 'Итого: ';

  const totalValue = document.createElement('strong');
  totalValue.id = 'booking-total-value';
  totalValue.textContent = '—';

  total.append(totalValue);

  const submitButton = document.createElement('button');
  submitButton.id = 'booking-submit';
  submitButton.type = 'submit';
  submitButton.className = 'booking-submit';
  submitButton.textContent = 'Подтвердить бронь';

  form.append(
    guestsLabel,
    guestsInput,
    guestsError,
    nightsLabel,
    nightsInput,
    nightsError,
    total,
    submitButton,
  );

  slot.replaceChildren(form);

  // Подписки и первичный расчёт — после подключения формы к документу,
  // чтобы getElementById в updateBookingTotal и validateBookingForm нашёл
  // поля; при значениях по умолчанию (1 ночь, 1 гость) итог сразу
  // показывает цену за 1 ночь.
  guestsInput.addEventListener('input', () => updateBookingTotal(house));
  nightsInput.addEventListener('input', () => updateBookingTotal(house));
  // Валидация T-26 — отдельным слушателем поверх пересчёта итога: ошибки
  // появляются и исчезают по мере ввода. До первого ввода контейнеры
  // ошибок остаются пустыми (showBookingErrors при рендере не вызывается).
  const validateOnInput = () => {
    showBookingErrors(validateBookingForm(house).errors);
  };
  guestsInput.addEventListener('input', validateOnInput);
  nightsInput.addEventListener('input', validateOnInput);
  updateBookingTotal(house);
}

// Номер следующей брони (T-27): «Б-» + номер с паддингом до 4 знаков
// (Б-0001, Б-0002…). Счётчик bookingSeq монотонно растёт и не опускается
// ниже максимального числового суффикса среди существующих броней (ид, не
// подходящие под шаблон /^Б-(\d+)$/, в расчёт не берутся), поэтому номера
// отменённых броней не переиспользуются: после отмены всех записей новая
// бронь получает следующий номер, а не снова Б-0001 (T-31).
let bookingSeq = 0;

function nextBookingId() {
  let max = bookingSeq;
  for (const booking of state.bookings) {
    const match = /^Б-(\d+)$/.exec(booking.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  bookingSeq = max + 1;
  return `Б-${String(bookingSeq).padStart(4, '0')}`;
}

// Семантическая чистка восстановленных броней (T-34) поверх структурной
// валидации loadBookings (T-33: там проверяются только типы полей).
// Запись отбрасывается, если:
// - houseId неизвестен (getHouseById вернул null — дома нет среди HOUSES);
// - id или houseId уже встречались раньше в массиве (дубликат записи или
//   вторая активная бронь того же дома) — остаётся первая, остальные уходят;
// - guests, nights или total — не положительные целые числа (ноль,
//   отрицательные, дробные значения бессмысленны для брони).
// Осознанно НЕ отбрасываются: большие значения (например, nights 500) —
// структурно валидная бронь считается фактом, предел 1..30 действует только
// в форме новой брони; guests сверх capacity дома — тоже факт прошлой брони.
// Возвращает { kept, dropped }: kept — оставшиеся записи в исходном порядке,
// dropped — число отброшенных.
function sanitizeRestoredBookings(bookings) {
  const seenIds = new Set();
  const seenHouseIds = new Set();
  const kept = [];
  let dropped = 0;

  for (const booking of bookings) {
    const houseKnown = getHouseById(booking.houseId) !== null;
    const positiveIntegers = [booking.guests, booking.nights, booking.total]
      .every((value) => Number.isInteger(value) && value > 0);
    const duplicate = seenIds.has(booking.id) || seenHouseIds.has(booking.houseId);

    if (!houseKnown || !positiveIntegers || duplicate) {
      dropped += 1;
      continue;
    }

    seenIds.add(booking.id);
    seenHouseIds.add(booking.houseId);
    kept.push(booking);
  }

  return { kept, dropped };
}

// Восстановление броней при загрузке страницы (T-33). loadBookings сам state
// не мутирует — результат применяется здесь:
// - ok: массив проходит семантическую чистку (sanitizeRestoredBookings, T-34),
//   оставшиеся записи заменяют state.bookings, а bookingSeq поднимается
//   до максимального числового суффикса среди оставшихся id (id вне
//   шаблона /^Б-(\d+)$/ в расчёт не берутся), чтобы nextBookingId после
//   перезагрузки продолжал нумерацию, а не начинал с Б-0001 заново.
//   Если чистка отбросила хоть одну запись, пользователь видит уведомление
//   о пропущенных бронях, а ключ перезаписывается очищенным массивом через
//   saveBookings (state уже применён, поэтому в хранилище уходит именно
//   очищенное состояние); чистые данные загружаются бесшумно, без записи;
// - parse/shape (данные повреждены): чистое состояние + уведомление, ключ
//   перезаписывается валидным пустым JSON через saveBookings, чтобы
//   следующие загрузки не падали снова (если записать нельзя — ключ
//   остаётся как есть);
// - unavailable (хранилище недоступно): чистое состояние + предупреждение,
//   что брони не переживут обновление страницы.
// Фильтры и selectedId намеренно не восстанавливаются — только брони.
function restoreBookings() {
  const result = loadBookings();

  if (result.ok) {
    const { kept, dropped } = sanitizeRestoredBookings(result.bookings);
    state.bookings = kept;
    for (const booking of kept) {
      const match = /^Б-(\d+)$/.exec(booking.id);
      if (match) bookingSeq = Math.max(bookingSeq, Number(match[1]));
    }
    if (dropped > 0) {
      showNotice('Часть сохранённых броней повреждена и пропущена');
      // State уже очищен: saveBookings пишет в хранилище именно оставшиеся
      // записи, чтобы следующие загрузки не спотыкались о те же битые данные.
      saveBookings();
    }
    return;
  }

  state.bookings = [];
  if (result.error === 'unavailable') {
    showNotice('Браузер запрещает хранение — брони не сохранятся после обновления страницы');
    return;
  }

  showNotice('Сохранённые брони повреждены и сброшены — страница работает в чистом состоянии');
  // Чиним битые данные для следующих загрузок: под ключ уходит валидное
  // пустое состояние. Если запись запрещена (saveBookings вернул false) —
  // просто оставляем как есть.
  saveBookings();
}

// Флаг «бронирование обрабатывается» (T-28): закрывает повторный вход в
// confirmBooking, пока не завершился предыдущий вызов. Рендеры внутри
// синхронны, поэтому флаг снимается в finally сразу после обработки и не
// мешает следующей легальной брони.
let bookingInProgress = false;

// Подтверждение брони (T-27): при валидной форме создаёт ровно одну запись.
// Невалидные значения — только подсветка ошибок, запись не создаётся,
// а кнопка остаётся активной, чтобы исправить и отправить снова.
// Защита от дубликата при двойном клике (T-28), независимые слои
// (defence in depth):
// 1) модульный флаг bookingInProgress отсекает повторный вход, пока идёт
//    обработка предыдущего нажатия;
// 2) на время обработки кнопка #booking-submit получает disabled —
//    визуально «нажатие обрабатывается» (после renderApp форма
//    пересоздаётся, и кнопка снова активна);
// 3) перед созданием записи проверяются isOccupied (гонка: дом уже занят
//    в этой сессии) и findBookingByHouse (активная бронь на этот дом уже
//    есть — осознанно дублирует isOccupied).
// После создания записи брони сохраняются в localStorage (T-32); если
// хранение запрещено, стандартное уведомление заменяется предупреждением.
// Экспортирована для тестов.
export function confirmBooking(house) {
  if (bookingInProgress) return;
  bookingInProgress = true;
  try {
    const result = validateBookingForm(house);
    if (!result.valid) {
      showBookingErrors(result.errors);
      // Кнопка снова активна: значения можно исправить и отправить повторно.
      const failedSubmit = document.getElementById('booking-submit');
      if (failedSubmit) failedSubmit.disabled = false;
      return;
    }

    // Нажатие обрабатывается: гасим кнопку до пересоздания формы.
    const submitButton = document.getElementById('booking-submit');
    if (submitButton) submitButton.disabled = true;

    if (isOccupied(house)) {
      showNotice('Этот дом уже забронирован');
      return;
    }

    if (findBookingByHouse(house.id)) {
      showNotice('Бронь на этот дом уже создана');
      return;
    }

    const booking = {
      id: nextBookingId(),
      houseId: house.id,
      houseName: house.name,
      guests: result.guests,
      nights: result.nights,
      total: house.pricePerNight * result.nights,
      createdAt: new Date().toISOString(),
    };

    addBooking(booking);
    // Сохранение до рендера (T-32): в localStorage уходит то же состояние,
    // которое пользователь увидит на экране.
    const saved = saveBookings();
    clearSelection();
    renderApp();
    if (saved) {
      showNotice(
        `Бронь ${booking.id} создана: ${booking.houseName}, `
          + `${booking.nights} ${plural(booking.nights, ['ночь', 'ночи', 'ночей'])}`
          + ` — ${formatPrice(booking.total)}`,
      );
    } else {
      // Браузер запретил хранение: бронь живёт только до обновления страницы.
      showNotice(
        `Бронь ${booking.id} создана, но не сохранится после обновления (хранение запрещено)`,
      );
    }
  } finally {
    bookingInProgress = false;
  }
}

// Список броней (T-30): пустое состояние «Пока нет броней» (p.bookings-empty)
// или список ul.bookings из карточек li.booking-card, по одной на запись.
// Новые брони сверху: state.bookings рендерится через slice().reverse(),
// сам массив не мутирует. Карточка: первая строка (p.booking-card__head) —
// id, название дома и дата создания по-русски (time с datetime=ISO); вторая
// строка — «N гостей · M ночей» со склонениями; сумма formatPrice(total);
// последним — span.booking-card__actions с кнопкой отмены (T-31).
// Только createElement/textContent, без innerHTML.
function renderBookings() {
  const container = elements['bookings-list'];
  if (!container) return;

  if (state.bookings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'bookings-empty';
    empty.textContent = 'Пока нет броней';
    container.replaceChildren(empty);
    return;
  }

  const items = state.bookings.slice().reverse().map((booking) => {
    const item = document.createElement('li');
    item.className = 'booking-card';
    item.dataset.bookingId = booking.id;

    const head = document.createElement('p');
    head.className = 'booking-card__head';

    const id = document.createElement('strong');
    id.className = 'booking-card__id';
    id.textContent = booking.id;

    const house = document.createElement('span');
    house.className = 'booking-card__house';
    house.textContent = booking.houseName;

    const date = document.createElement('time');
    date.className = 'booking-card__date';
    date.setAttribute('datetime', booking.createdAt);
    date.textContent = new Date(booking.createdAt).toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

    head.append(id, house, date);

    const details = document.createElement('span');
    details.className = 'booking-card__details';
    details.textContent =
      `${booking.guests} ${plural(booking.guests, ['гость', 'гостя', 'гостей'])}`
        + ` · ${booking.nights} ${plural(booking.nights, ['ночь', 'ночи', 'ночей'])}`;

    const total = document.createElement('strong');
    total.className = 'booking-card__total';
    total.textContent = formatPrice(booking.total);

    const actions = document.createElement('span');
    actions.className = 'booking-card__actions';

    // Кнопка отмены (T-31): id брони в data-booking-id, обработка клика —
    // делегированным слушателем на #bookings-list (setupBookingsHandlers).
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'booking-cancel';
    cancel.dataset.bookingId = booking.id;
    cancel.textContent = 'Отменить';

    actions.append(cancel);

    item.append(head, details, total, actions);
    return item;
  });

  const list = document.createElement('ul');
  list.className = 'bookings';
  list.append(...items);

  container.replaceChildren(list);
}

// Отмена брони (T-31): удаляет запись и перерендеривает приложение — дом
// снова становится свободным в списке и на схеме через isOccupied.
// Подтверждение не требуется: отмена — одно нажатие. Если отменённый дом
// сейчас выбран (selectedId === removed.houseId), выбор остаётся: дом
// свободен, это корректное состояние, ничего специально делать не нужно.
// После удаления брони сохраняются в localStorage (T-32); запрет хранения
// заменяет уведомление предупреждением, что отмена не переживёт обновление.
function cancelBooking(bookingId) {
  const removed = removeBooking(bookingId);
  if (removed === null) {
    showNotice('Бронь не найдена');
    return;
  }

  const saved = saveBookings();
  renderApp();
  if (saved) {
    showNotice(`Бронь ${removed.id} отменена — дом «${removed.houseName}» снова свободен`);
  } else {
    showNotice('Бронь отменена, но изменения не сохранятся после обновления');
  }
}

// Делегирование на #bookings-list: один обработчик переживает перерендеры
// списка и ловит клики по кнопкам отмены всех карточек.
function setupBookingsHandlers() {
  const container = elements['bookings-list'];
  if (!container) return;

  container.addEventListener('click', (event) => {
    const button = event.target.closest('.booking-cancel');
    if (!button) return;

    cancelBooking(button.dataset.bookingId);
  });
}

// Плашка #selection-notice: пустой текст скрывает её (CSS-правило .notice:empty).
function showNotice(text) {
  const notice = elements['selection-notice'];
  if (notice) notice.textContent = text;
}

function clearNotice() {
  showNotice('');
}

// Сверка выбора с фильтрами (T-21): если выбранный дом больше не проходит
// фильтры, выбор сбрасывается, а пользователь видит причину в #selection-notice.
// Дом остался видимым — выбор и текущее сообщение не трогаем.
// Вызывается в обработчиках фильтров после setFilters/resetFilters и до renderApp().
function reconcileSelectionWithFilters() {
  if (state.selectedId === null) return;

  const stillVisible = getFilteredHouses(HOUSES).some(
    (house) => house.id === state.selectedId,
  );
  if (stillVisible) return;

  clearSelection();
  showNotice('Выбранный дом скрыт фильтрами — выбор сброшен');
}

// Общая логика попытки выбора дома: используется и списком, и схемой.
// Клавиатурная гарантия: aria-disabled сам по себе не блокирует активацию
// Enter/Space, но кнопки выбора — это <button>, поэтому активация с клавиатуры
// генерирует событие click, которое проходит через тот же делегированный
// обработчик и отсекается проверкой isOccupied ниже, как и клик мышью.
// Экспортирована для тестируемости.
export function trySelectHouse(houseId) {
  const house = getHouseById(houseId);
  if (!house) return;

  if (isOccupied(house)) {
    showNotice(`Дом „${house.name}“ занят — выберите свободный`);
    return;
  }

  // Повторный клик по выбранному дому: выбор не меняется, DOM не дёргаем.
  if (isSelected(house)) return;

  selectHouse(house.id);
  clearNotice();
  renderApp();
}

// Делегирование на #house-list: один обработчик переживает перерендеры списка.
function setupListHandlers() {
  const container = elements['house-list'];
  if (!container) return;

  container.addEventListener('click', (event) => {
    const button = event.target.closest('.house-item');
    if (!button) return;

    trySelectHouse(button.dataset.houseId);
  });
}

// Делегирование на #scheme: выбор дома кликом по схеме, зеркально списку.
function setupSchemeHandlers() {
  const container = elements.scheme;
  if (!container) return;

  container.addEventListener('click', (event) => {
    const button = event.target.closest('.scheme-house');
    if (!button) return;

    trySelectHouse(button.dataset.houseId);
  });
}

// Фильтры: число гостей (change) и максимальная цена за ночь (input —
// реакция по мере ввода). Кнопка «Сбросить фильтры» очищает поля и состояние
// и показывает уведомление в #selection-notice. Каждая смена фильтров сверяет
// выбор с результатом через reconcileSelectionWithFilters() (T-21);
// сообщение сверки здесь ничем не затирается (clearNotice не вызывается).
function setupFilterHandlers() {
  const form = elements.filters;
  if (form) {
    // Поля внутри формы: блокируем сабмит, чтобы Enter в поле ввода
    // не перезагружал страницу.
    form.addEventListener('submit', (event) => {
      event.preventDefault();
    });
  }

  const guestsSelect = document.getElementById('filter-guests');
  if (guestsSelect) {
    guestsSelect.addEventListener('change', () => {
      setFilters({ guests: Number(guestsSelect.value) });
      reconcileSelectionWithFilters();
      renderApp();
    });
  }

  // Цена: пустое поле, NaN и значения <= 0 снимают фильтр;
  // дробные значения округляются вниз.
  const priceInput = document.getElementById('filter-price');
  if (priceInput) {
    priceInput.addEventListener('input', () => {
      const value = priceInput.valueAsNumber;
      setFilters({
        maxPrice: Number.isNaN(value) || value <= 0 ? 0 : Math.floor(value),
      });
      reconcileSelectionWithFilters();
      renderApp();
    });
  }

  // Сброс: очищаем поля формы и состояние фильтров, возвращаем полный список
  // и сообщаем об этом в #selection-notice (сообщение показывается всегда,
  // даже если фильтры не были заданы). Сверка выбора стоит до сообщения:
  // после resetFilters видны все дома, reconcile ничего не сбросит, а если бы
  // сбросил — финальным всё равно остаётся сообщение о сбросе фильтров.
  const resetButton = document.getElementById('filter-reset');
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      if (guestsSelect) guestsSelect.value = '0';
      if (priceInput) priceInput.value = '';
      resetFilters();
      reconcileSelectionWithFilters();
      renderApp();
      showNotice('Фильтры сброшены — показаны все дома');
    });
  }
}

// Полный сброс демо (T-35): кнопка #reset-demo в разделе «Мои брони».
// Сброс выполняется только после подтверждения window.confirm — при отмене
// состояние не меняется вообще. При подтверждении:
// - брони очищаются, выбор и фильтры сбрасываются (resetFilters чистит
//   только state, поэтому значения полей фильтров в DOM возвращаем явно:
//   гости — '0', цена — пустая строка; поля формы брони не трогаем —
//   карточка перерендерится вместе со слотом формы);
// - нумерация броней начинается заново (bookingSeq = 0): сброс — это
//   возврат к начальному состоянию демо, поэтому следующая бронь снова Б-0001;
// - из localStorage удаляется ТОЛЬКО ключ приложения STORAGE_KEY:
//   localStorage.clear() запрещён, чужие ключи трогать нельзя. removeItem
//   в try/catch: запрет хранения (приватный режим) не должен ломать
//   страницу — состояние сбрасывается в любом случае, а при исключении
//   дополнительно предупреждаем, что хранилище не очищено.
// Изначально занятые дома (occupied: true в data.js) сброс не освобождает:
// это данные посёлка, а не брони.
function setupResetDemo() {
  const button = elements['reset-demo'];
  if (!button) return;

  button.addEventListener('click', () => {
    const confirmed = window.confirm(
      'Сбросить демо? Все брони будут удалены, дома станут свободными.',
    );
    if (!confirmed) return;

    state.bookings = [];
    clearSelection();
    resetFilters();
    bookingSeq = 0;

    const guestsSelect = document.getElementById('filter-guests');
    if (guestsSelect) guestsSelect.value = '0';
    const priceInput = document.getElementById('filter-price');
    if (priceInput) priceInput.value = '';

    let storageCleared = true;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      storageCleared = false;
    }

    renderApp();
    if (storageCleared) {
      showNotice('Демо сброшено — все брони удалены, дома свободны');
    } else {
      showNotice(
        'Демо сброшено — все брони удалены, дома свободны. '
          + 'Не удалось очистить хранилище (хранение запрещено) — '
          + 'после обновления страницы брони могут вернуться',
      );
    }
  });
}

// Глобальная подсказка под формой фильтров (T-22): видна, только когда
// фильтры заданы (guests > 0 или maxPrice > 0) и результат фильтрации пуст.
// aria-live ставится здесь: setAttribute идемпотентен, дублирования нет.
function renderFilterEmpty() {
  const notice = elements['filters-empty'];
  if (!notice) return;

  notice.setAttribute('aria-live', 'polite');

  const filtersActive = state.filters.guests > 0 || state.filters.maxPrice > 0;
  const empty = getFilteredHouses(HOUSES).length === 0;

  if (empty && filtersActive) {
    notice.textContent =
      'По этим фильтрам ничего не найдено — измените условия или сбросьте фильтры';
    notice.hidden = false;
  } else {
    notice.textContent = '';
    notice.hidden = true;
  }
}

export function renderApp() {
  renderFilterEmpty();
  renderHouseList();
  renderScheme();
  renderCard();
  renderBookings();
}

function bootstrap() {
  for (const id of CONTAINER_IDS) {
    const element = document.getElementById(id);
    if (!element) {
      console.warn(`Контейнер #${id} не найден на странице`);
    }
    elements[id] = element;
  }
  // Восстановление броней (T-33) — после кэша elements (showNotice пишет
  // в #selection-notice) и до первого renderApp, чтобы занятость домов
  // подхватилась сразу через isOccupied.
  restoreBookings();
  setupListHandlers();
  setupSchemeHandlers();
  setupBookingsHandlers();
  setupFilterHandlers();
  setupResetDemo();
  renderApp();
}

document.addEventListener('DOMContentLoaded', bootstrap);
