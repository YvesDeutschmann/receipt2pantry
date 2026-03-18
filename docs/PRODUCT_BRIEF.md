# Meald — Project Context

## Overview
Meald is a web application that automatically logs into grocery loyalty portals (Safeway, QFC/Kroger, Costco/Walmart), fetches digital receipts, parses them into structured data, and enriches them with recipe and meal-planning insights. It gives users a unified view of grocery spending, ingredients, and meal possibilities — turning receipts into actionable food data.

## Target Audience
- Busy households and individuals who want to save time and simplify grocery tracking  
- Meal planners aiming to reduce food waste and organize weekly meals  
- Multi-chain shoppers who buy from different grocery stores and want centralized visibility

## Core Features
- **Automated Portal Login** — Securely handles credentials and MFA for each loyalty program using Playwright automation  
- **Receipt Fetching & Parsing** — Extracts structured ingredient and price data from digital receipts  
- **Recipe Matching** — Links purchased ingredients to available recipes and meal plans  
- **Smart Substitutions** — Suggests replacements when ingredients are missing  
- **Leftover Tracking** — Detects cooked meals and tracks remaining servings for reuse in future plans  
- **Meal Planning Assistant** — Builds realistic, weekly meal plans from available ingredients  
- **Hands-Free Cooking** — Voice-guided recipe steps for cooking without touching devices  
- **Secure Storage** — User data stored and synced via Supabase

## Benefits
- Eliminates manual data entry and receipt tracking  
- Reduces food waste through visibility and leftover reuse  
- Simplifies meal planning with auto-generated plans and recipe suggestions  
- Centralizes loyalty data across multiple grocery chains

## Functional Focus
Each loyalty program integration (Safeway, QFC, Costco/Walmart) is implemented as an independent module and task in early sprints. This structure allows adding new programs without affecting the existing system.

## Vision
Meald transforms routine grocery data into a meal intelligence system — combining automation, structured data, and personalized planning to make cooking and food management effortless.

---

