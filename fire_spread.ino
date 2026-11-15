#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);   

const int JOY_X  = A0;
const int JOY_Y  = A1;
const int JOY_SW = 2;
const int buzzer = 11;


const float FIRE_LAT = 33.6844;
const float FIRE_LON = 73.0479;


int  risk[3][3];    
byte cause[3][3];   

const char* dirNames[3][3] = {
  { "N-West", "North", "N-East" },
  { "West",   "FIRE",  "East"   },
  { "S-West", "South", "S-East" }
};

const char* causes[] = {
  "Dryness",
  "Dense vegetation",
  "Strong wind",
  "Low humidity",
  "Steep slope",
  "Dry grass",
  "High temperature"
};
const byte NUM_CAUSES = sizeof(causes) / sizeof(causes[0]);


int spreadRow = 0;
int spreadCol = 1;


int lastRow = -1;
int lastCol = -1;

// ---------- Helpers ----------
void printLine(byte row, String text) {
  while (text.length() < 16) text += ' ';      
  lcd.setCursor(0, row);
  lcd.print(text.substring(0, 16));
}

void showDefault() {
  printLine(0, "Lat: " + String(FIRE_LAT, 4));
  printLine(1, "Lon: " + String(FIRE_LON, 4));
}

void showDirection(int r, int c) {
  printLine(0, String(dirNames[r][c]) + " Risk:" + String(risk[r][c]));
  printLine(1, causes[cause[r][c]]);
}
void emergency() {
  for (int i = 0; i < 3; i++) {

    digitalWrite(buzzer, HIGH);

    lcd.setCursor(0, 0);
    lcd.print(" EMERGENCY! ");

    lcd.setCursor(0, 1);
    lcd.print(" Huge Fire ");

    delay(1000);

    digitalWrite(buzzer, LOW);
    lcd.clear();

    delay(500);
  }}

void generateScenario() {
  
  int idx = random(8);
  if (idx >= 4) idx++;
  spreadRow = idx / 3;
  spreadCol = idx % 3;

  for (int r = 0; r < 3; r++) {
    for (int c = 0; c < 3; c++) {
      if (r == 1 && c == 1) {
        risk[r][c]  = 0;                       
        cause[r][c] = 0;
      } else if (r == spreadRow && c == spreadCol) {
        risk[r][c]  = random(75, 100);         
        cause[r][c] = random(NUM_CAUSES);
      } else {
        risk[r][c]  = random(5, 60);
        cause[r][c] = random(NUM_CAUSES);
      }
    }
  }

  
  Serial.println("--- New scenario (risk) ---");
  for (int r = 0; r < 3; r++) {
    for (int c = 0; c < 3; c++) {
      Serial.print(r == 1 && c == 1 ? "FIRE" : String(risk[r][c]));
      Serial.print('\t');
    }
    Serial.println();
  }
  Serial.print("Main spread direction: ");
  Serial.println(dirNames[spreadRow][spreadCol]);
}

void setup() {
  Serial.begin(9600);
  pinMode(JOY_SW, INPUT_PULLUP);
  pinMode(buzzer,OUTPUT);

  randomSeed(analogRead(A5));                 

  lcd.init();
  lcd.backlight();

  printLine(0, "Fire Spread Demo");
  printLine(1, "Generating...");
  delay(1500);

  generateScenario();
  showDefault();
  emergency();
}

void loop() {
  
  if (digitalRead(JOY_SW) == LOW) {
    generateScenario();
    lastRow = -1;           
    lastCol = -1;
    printLine(0, "New scenario");
    printLine(1, "generated");
    delay(800);
    showDefault();
    delay(300);                              
    return;
  }

  int x = analogRead(JOY_X);
  int y = analogRead(JOY_Y);

  
  int dx = (x > 700) ? 1 : (x < 300) ? -1 : 0;
  int dy = (y > 700) ? 1 : (y < 300) ? -1 : 0;   

  int r = 1 + dy;
  int c = 1 + dx;

  if (r != lastRow || c != lastCol) {
    lastRow = r;
    lastCol = c;
    if (r == 1 && c == 1) {
      showDefault();                           
    } else {
      showDirection(r, c);
    }
  }

  delay(50);
}
