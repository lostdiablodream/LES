// Состояние приложения «Сосновый берег».
// Логика состояния без DOM; персистентность броней — saveBookings/loadBookings
// через localStorage под одним ключом STORAGE_KEY (T-32).

export const STORAGE_KEY = 'sosnovy-bereg-demo-v1';

export const state = {
  selectedId: null,
  filters: { guests: 0, maxPrice: 0 },
  bookings: [],
};

export function isOccupied(house) {
  return house.occupied || state.bookings.some((booking) => booking.houseId === house.id);
}

export function isSelected(house) {
  return house.id === state.selectedId;
}

export function getSelectedHouse(houses) {
  return houses.find((house) => house.id === state.selectedId) ?? null;
}

export function selectHouse(id) {
  state.selectedId = id;
}

export function clearSelection() {
  state.selectedId = null;
}

export function setFilters({ guests, maxPrice } = {}) {
  if (guests !== undefined) state.filters.guests = guests;
  if (maxPrice !== undefined) state.filters.maxPrice = maxPrice;
}

export function resetFilters() {
  state.filters = { guests: 0, maxPrice: 0 };
}

export function getFilteredHouses(houses) {
  const { guests, maxPrice } = state.filters;
  return houses.filter(
    (house) =>
      (guests <= 0 || house.capacity >= guests) &&
      (maxPrice <= 0 || house.pricePerNight <= maxPrice),
  );
}

export function addBooking(booking) {
  state.bookings.push(booking);
  return booking;
}

export function removeBooking(bookingId) {
  const index = state.bookings.findIndex((booking) => booking.id === bookingId);
  if (index === -1) return null;
  return state.bookings.splice(index, 1)[0];
}

export function findBookingByHouse(houseId) {
  return state.bookings.find((booking) => booking.houseId === houseId);
}

// Сохранение броней (T-32): весь массив сериализуется в JSON под одним
// ключом STORAGE_KEY. Других ключей приложение не использует, хранилище
// целиком не очищается.
// Возвращает true при успехе и false, когда записать нельзя: localStorage
// отсутствует (среда без DOM) или setItem бросил исключение (приватный
// режим, исчерпанная квота). Бронь при этом остаётся в state — вызывающий
// код решает, как сообщить, что после обновления она пропадёт.
export function saveBookings() {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bookings: state.bookings }));
    return true;
  } catch {
    return false;
  }
}

// Чтение сохранённых броней (T-32). State здесь НЕ мутируется: применение
// результата — задача восстановления при загрузке (T-33).
// Результат: { ok: true, bookings } (записи ещё не было — bookings пуст,
// это не ошибка) или { ok: false, error: 'unavailable' | 'parse' | 'shape' }
// (хранилище недоступно: localStorage нет или getItem бросил исключение,
// JSON битый, структура не соответствует записи брони).
export function loadBookings() {
  if (typeof localStorage === 'undefined') return { ok: false, error: 'unavailable' };

  // getItem тоже может бросить (чтение запрещено) — это тот же случай
  // недоступного хранилища, что и отсутствие localStorage.
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  if (raw === null) return { ok: true, bookings: [] };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'parse' };
  }

  const isValidBooking = (booking) => booking !== null
    && typeof booking === 'object'
    && typeof booking.id === 'string'
    && typeof booking.houseId === 'string'
    && typeof booking.houseName === 'string'
    && typeof booking.guests === 'number'
    && typeof booking.nights === 'number'
    && typeof booking.total === 'number';

  const valid = parsed !== null
    && typeof parsed === 'object'
    && Array.isArray(parsed.bookings)
    && parsed.bookings.every(isValidBooking);
  if (!valid) return { ok: false, error: 'shape' };

  return { ok: true, bookings: parsed.bookings };
}
