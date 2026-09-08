const images = {
  "groningen": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/groningen.png",
  "leeuwarden": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/leeuwarden.png",
  "assen": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/assen.png",
  "zwolle": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/zwolle.png",
  "lelystad": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/lelystad.png",
  "arnhem": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/arnhem.png",
  "utrecht": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/utrecht.png",
  "haarlem": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/haarlem.png",
  "den haag": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/den-haag.png",
  "middelburg": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/middelburg.png",
  "’s-hertogenbosch": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/den-bosch.png",
  "maastricht": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/maastricht.png",
  "amsterdam": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/amsterdam.png",
  "rotterdam": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/rotterdam.png",
  "delft": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/delft.png",
  "leiden": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/leiden.png",
  "enschede": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/enschede.png",
  "wageningen": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/wageningen.png",
  "eindhoven": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/eindhoven.png",
  "tilburg": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/tilburg.png",
  "nijmegen": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/nijmegen.png",
  "heerlen": "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/heerlen.png"
};
export const defaultCoffee = "https://pub-80e888b848404fa086be09be4e975eb8.r2.dev/city-latte/v1/default.png";
export function cityCoffee(city){const key=String(city||'').normalize('NFKC').trim().toLowerCase();return images[key]||images[({'den bosch':'’s-hertogenbosch',"'s-hertogenbosch":'’s-hertogenbosch','the hague':'den haag'})[key]]||defaultCoffee;}
