#include <Wire.h>

#include <Adafruit_LiquidCrystal.h>

Adafruit_LiquidCrystal lcd (0);



int trigPin =2;;

int echoPin = 3;

int led1 = 13;
int led2 = 12;
int led3 = 11;


int fan1 = 10;
int fan2 = 9;
int buzzerPin = 4;
int occupants =0 ;
bool isBeamBroken =false ;

void setup(){


  pinMode(trigPin,OUTPUT);

  pinMode(echoPin,INPUT);
  
  pinMode(led1, OUTPUT);
  pinMode(led2,OUTPUT);

  pinMode(led3, OUTPUT);

  pinMode(fan1, OUTPUT);
  pinMode(fan2, OUTPUT);
  pinMode(buzzerPin, OUTPUT);
  
  lcd.begin(16, 2) ;;
  lcd.setBacklight(1);


  lcd.print("OfficeIQ System" ) ;
  lcd.setCursor(0,1);
  lcd.print("Occupants: 0" );

  
  Serial.begin(9600);

}

void loop(){

  digitalWrite(trigPin,LOW);

  delayMicroseconds(2);

  digitalWrite(trigPin,HIGH);

  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  
  long duration = pulseIn(echoPin, HIGH);
  int distance = duration * 0.034 / 2;

  if (distance < 100) {
    if (!isBeamBroken) {
      occupants++;
      isBeamBroken = true;
      
      tone(buzzerPin, 2000, 100); 


      delay(150);

      tone(buzzerPin, 1500, 150);
      
      
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Motion Detected!");
      lcd.setCursor(0, 1);
      lcd.print("Occupants: ");
      lcd.print(occupants);
      
      Serial.print("Count: ");
      Serial.println(occupants);
    }
  } else {
    isBeamBroken =false; 
  }

  if (occupants>0){
    digitalWrite(led1, HIGH);

    digitalWrite(led2, HIGH);
    digitalWrite(led3, HIGH);

    digitalWrite(fan1, HIGH);
    digitalWrite(fan2, HIGH);
  } else {
    digitalWrite(led1, LOW);
    digitalWrite(led2, LOW);

    digitalWrite(led3, LOW);

    digitalWrite(fan1, LOW);
    digitalWrite(fan2, LOW);
  }
  
  delay(100);
}
