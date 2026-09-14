#!/bin/bash
# Update imports in risk-mapping clone
# Change @/lib imports to use adapters or relative paths

RISK_MAPPING_DIR="C:/Users/SrydenID/Documents/GitHub/Asset-Detection/risk-mapping"

echo "Updating @/lib/db imports..."
find "$RISK_MAPPING_DIR" -type f \( -name "*.ts" -o -name "*.tsx" \) ! -path "*/node_modules/*" ! -path "*/.next/*" | while read file; do
    if grep -q "from '@/lib/db'" "$file"; then
        # Replace @/lib/db with relative path based on file location
        sed -i "s|from '@/lib/db'|from '@/risk-mapping/lib/adapters'|g" "$file"
        echo "  Updated: $file"
    fi
done

echo "Updating @/lib/auth imports..."
find "$RISK_MAPPING_DIR" -type f \( -name "*.ts" -o -name "*.tsx" \) ! -path "*/node_modules/*" ! -path "*/.next/*" | while read file; do
    if grep -q "from '@/lib/auth'" "$file"; then
        sed -i "s|from '@/lib/auth'|from '@/risk-mapping/lib/adapters'|g" "$file"
        echo "  Updated: $file"
    fi
done

echo "Updating @/lib/authz imports..."
find "$RISK_MAPPING_DIR" -type f \( -name "*.ts" -o -name "*.tsx" \) ! -path "*/node_modules/*" ! -path "*/.next/*" | while read file; do
    if grep -q "from '@/lib/authz'" "$file"; then
        sed -i "s|from '@/lib/authz'|from '@/risk-mapping/lib/adapters'|g" "$file"
        echo "  Updated: $file"
    fi
done

echo "Done!"
