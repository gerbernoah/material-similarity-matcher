#!/bin/bash

# Number of materials to generate (default: 50)
NUM_MATERIALS=${1:-20}

# Arrays for random generation
TYPES=("A" "B" "C" "D" "E" "F" "G" "H")
CATEGORY_CODES=("01" "02" "03" "04" "05" "06" "07" "08" "09")
SUB_CATEGORY_CODES=("01" "02" "03" "04" "05")

MATERIAL_NAMES=(
  "steel beam" "wooden plank" "concrete slab" "insulation panel" "ceramic tiles"
  "glass panel" "aluminum frame" "plastic sheet" "copper wire" "rubber gasket"
  "stone block" "metal bracket" "foam padding" "vinyl flooring" "tile adhesive"
  "plywood sheet" "drywall panel" "roofing shingle" "door frame" "window sill"
  "paint bucket" "gravel aggregate" "sand bag" "cement mix" "mortar blend"
  "brick unit" "paver stone" "marble slab" "granite countertop" "laminate board"
)

DESCRIPTIONS=(
  "high quality construction material"
  "durable and weather resistant"
  "eco-friendly and sustainable"
  "industrial grade component"
  "premium quality material"
  "cost-effective solution"
  "heavy duty construction element"
  "lightweight and portable"
  "corrosion resistant material"
  "fire-rated building component"
)

# Function to generate a UUID v4
generate_uuid() {
  cat /proc/sys/kernel/random/uuid
}

# Generate materials JSON
generate_materials() {
  echo '{"materials":['
  
  for ((i=0; i<NUM_MATERIALS; i++)); do
    # Generate random UUID
    UUID=$(generate_uuid)
    
    # Random selections
    TYPE=${TYPES[$RANDOM % ${#TYPES[@]}]}
    CAT=${CATEGORY_CODES[$RANDOM % ${#CATEGORY_CODES[@]}]}
    SUBCAT=${SUB_CATEGORY_CODES[$RANDOM % ${#SUB_CATEGORY_CODES[@]}]}
    NAME=${MATERIAL_NAMES[$RANDOM % ${#MATERIAL_NAMES[@]}]}
    DESC=${DESCRIPTIONS[$RANDOM % ${#DESCRIPTIONS[@]}]}
    
    # Random numeric values
    PRICE=$((RANDOM % 500 + 10))
    QUALITY=$(awk -v seed=$RANDOM 'BEGIN{srand(seed); printf "%.2f", rand()}')
    WIDTH=$((RANDOM % 300 + 10))
    HEIGHT=$((RANDOM % 400 + 5))
    DEPTH=$((RANDOM % 100 + 1))
    LAT=$(awk -v seed=$RANDOM 'BEGIN{srand(seed); printf "%.4f", 46 + rand() * 2}')
    LON=$(awk -v seed=$RANDOM 'BEGIN{srand(seed); printf "%.4f", 6 + rand() * 3}')
    
    # Add comma if not first element
    if [ $i -gt 0 ]; then
      echo ","
    fi
    
    # Generate material JSON
    cat <<EOF
    {
      "id": "$UUID",
      "ebkp": {
        "type": "$TYPE",
        "categoryCode": "$CAT",
        "subCategoryCode": "$SUBCAT"
      },
      "name": "$NAME",
      "description": "$DESC",
      "price": $PRICE,
      "quality": $QUALITY,
      "size": {
        "width": $WIDTH,
        "height": $HEIGHT,
        "depth": $DEPTH
      },
      "location": {
        "latitude": $LAT,
        "longitude": $LON
      }
    }
EOF
  done
  
  echo ']}'
}

echo "Generating $NUM_MATERIALS random materials..."

# Generate and send materials
generate_materials | curl -X POST http://localhost:8787/v1/materials/add \
  -H "Content-Type: application/json" \
  -d @-
