import { SITE_SECTIONS } from "./site-composition";

export const MEDIA_SECTIONS = SITE_SECTIONS.filter(
  ({ id }) => id !== "numbers" && id !== "sponsors",
);
export type MediaSection = (typeof MEDIA_SECTIONS)[number]["id"];
export type SiteImage = {
  url: string;
  title: string;
  credit?: string;
  source?: string;
  attributionRequired?: boolean;
};
export type ClubPhoto = { id: string; title: string; image_url: string };
export type MediaChoice = { kind: "stock" | "club"; id: string };
export type MediaRow = {
  section: string;
  stock_id: string | null;
  photo_id: string | null;
};

export const MEDIA_SPORTS = {
  football: "Football",
  muaythai: "Muay thaï",
  boxe: "Boxe anglaise",
  handball: "Handball",
  basketball: "Basket",
  judo: "Judo",
  karate: "Karaté",
} as const;
export type MediaSport = keyof typeof MEDIA_SPORTS;
export const MEDIA_AUDIENCES = [
  "Enfants",
  "Ados",
  "Femmes",
  "Hommes",
  "Mixte",
  "Matériel",
] as const;
type Audience = (typeof MEDIA_AUDIENCES)[number];

function photo(
  sport: MediaSport,
  id: string,
  slug: string,
  title: string,
  credit: string,
  audiences: Audience[],
) {
  return {
    id,
    sport,
    title,
    credit,
    audiences,
    license: "Pexels",
    attributionRequired: false,
    source: "https://www.pexels.com/photo/" + slug + "-" + id + "/",
    url:
      "https://images.pexels.com/photos/" +
      id +
      "/pexels-photo-" +
      id +
      ".jpeg?auto=compress&w=1400",
  };
}

export const STOCK_PHOTOS = [
  photo(
    "football",
    "30584997",
    "soccer-team-training-session-on-green-field",
    "Entraînement sur le terrain",
    "Franco Monsalvo",
    ["Hommes"],
  ),
  photo(
    "football",
    "8941563",
    "children-wearing-jerseys-walking-on-a-football-field",
    "Jeunes joueurs sur le terrain",
    "Kampus Production",
    ["Enfants"],
  ),
  photo(
    "muaythai",
    "12121709",
    "woman-doing-muay-thai-training",
    "Travail technique en salle",
    "Juliia Abramova",
    ["Femmes"],
  ),
  photo(
    "muaythai",
    "5750838",
    "men-training-in-a-gym",
    "Entraînement au sac",
    "Tima Miroshnichenko",
    ["Hommes"],
  ),
  photo(
    "boxe",
    "6296118",
    "boxing-gloves-on-the-bench",
    "Gants posés sur un banc",
    "Pavel Danilyuk",
    ["Matériel"],
  ),
  photo(
    "boxe",
    "8611297",
    "empty-boxing-gym",
    "Salle de boxe et ring",
    "RDNE Stock project",
    ["Matériel"],
  ),
  photo(
    "handball",
    "25048041",
    "women-playing-handball",
    "Handball féminin en salle",
    "Laura Rieusset",
    ["Femmes"],
  ),
  photo(
    "handball",
    "37097043",
    "exciting-indoor-handball-match-in-action",
    "Tir en suspension",
    "Mohamed Ayman Marso",
    ["Hommes"],
  ),
  photo(
    "basketball",
    "6767214",
    "group-of-athletes-playing-basketball-on-the-court",
    "Basket féminin en salle",
    "cottonbro studio",
    ["Femmes"],
  ),
  photo(
    "basketball",
    "38745606",
    "youth-basketball-training-session-in-victoria-gym",
    "Entraînement des ados",
    "Vlad Vasnetsov",
    ["Ados"],
  ),
  photo(
    "basketball",
    "8337502",
    "kid-playing-basketball-on-the-court",
    "Basket en extérieur",
    "RDNE Stock project",
    ["Enfants"],
  ),
  photo(
    "judo",
    "19437725",
    "kids-during-judo-class",
    "Cours de judo pour enfants",
    "Ruslan Alekso",
    ["Enfants"],
  ),
  photo(
    "judo",
    "6765028",
    "woman-and-man-training-on-combat-sports",
    "Judo adulte en binôme",
    "Kampus Production",
    ["Femmes", "Hommes", "Mixte"],
  ),
  photo(
    "karate",
    "6005457",
    "two-women-training-martial-arts",
    "Pratique du karaté",
    "olia danilevich",
    ["Femmes"],
  ),
  photo(
    "karate",
    "19437715",
    "children-wearing-kimonos",
    "Cours de karaté pour enfants",
    "Ruslan Alekso",
    ["Enfants"],
  ),
  photo(
    "football",
    "7078119",
    "photograph-of-women-playing-soccer",
    "Football féminin en match",
    "Erik Geiger",
    ["Femmes"],
  ),
  photo(
    "boxe",
    "7991641",
    "focused-woman-practicing-boxing-with-trainer",
    "Travail au sac avec un entraîneur",
    "Annushka Ahuja",
    ["Femmes"],
  ),
  photo(
    "boxe",
    "33408975",
    "young-male-boxer-training-in-a-ring",
    "Entraînement sur le ring",
    "Abdelilah Hibat Allah",
    ["Hommes"],
  ),
  photo(
    "boxe",
    "6720433",
    "a-boy-wearing-black-boxing-gloves",
    "Initiation à la boxe",
    "Gustavo Fring",
    ["Enfants"],
  ),
  photo(
    "basketball",
    "11831849",
    "two-men-playing-basketball",
    "Basket masculin en salle",
    "Zekai Zhu",
    ["Hommes"],
  ),
];

export function stockPhoto(id: string | null | undefined) {
  return STOCK_PHOTOS.find((item) => item.id === id);
}

export function resolveMedia(
  rows: MediaRow[],
  photos: ClubPhoto[],
): Partial<Record<MediaSection, SiteImage>> {
  const images: Partial<Record<MediaSection, SiteImage>> = {};
  for (const { id } of MEDIA_SECTIONS) {
    const row = rows.find((item) => item.section === id);
    const stock = stockPhoto(row?.stock_id);
    const club = photos.find((photo) => photo.id === row?.photo_id);
    if (stock) images[id] = stock;
    else if (club) images[id] = { url: club.image_url, title: club.title };
  }
  return images;
}
