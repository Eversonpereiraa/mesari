/**
 * Restaurante do usuário logado (vários restaurantes no mesmo banco).
 * O id vem do perfil (profiles.restaurante_id); o código (6 dígitos) é o que os funcionários
 * digitam no login e fica guardado no aparelho depois da primeira entrada.
 */
let restaurantId: number | null = null;

export const getRestaurantId = () => restaurantId;
export const setRestaurantId = (id: number | null) => {
  restaurantId = id;
};

/** id do restaurante ou erro (para gravações que precisam dele). */
export function requireRestaurantId() {
  if (restaurantId === null) throw new Error("Entre novamente: o restaurante não foi carregado.");
  return restaurantId;
}

const CODE_KEY = "mesari:codigo-restaurante";

export function savedRestaurantCode() {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveRestaurantCode(code: string) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code);
  } catch {
    // Armazenamento indisponível: o código será pedido de novo no próximo login.
  }
}
