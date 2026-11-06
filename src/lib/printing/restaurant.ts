/**
 * Dados do restaurante usados pelos impressos que não recebem o restaurante de quem chama
 * (comanda de delivery). O AppShell mantém isto em dia a partir do store.
 */
import type { PrintRestaurant } from "./types";

let current: PrintRestaurant = { name: "", address: "", phone: "", cnpj: "", instagram: "" };

export function setPrintRestaurant(restaurant: PrintRestaurant) {
  current = restaurant;
}

export function getPrintRestaurant() {
  return current;
}
