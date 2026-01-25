"""AI Service for OpenAI integration with structured outputs"""

import json
from typing import Dict, List, Optional, Any
from datetime import datetime

from openai import OpenAI
from openai import APIError, RateLimitError, APIConnectionError
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

from backend.config import Config
from backend.utils.logger import get_logger
from backend.utils.exceptions import AIServiceException, AIRateLimitException

logger = get_logger(__name__)


class AIService:
    """Service for AI-powered operations using OpenAI"""
    
    def __init__(self, config: Optional[Config] = None):
        """
        Initialize AIService
        
        Args:
            config: Configuration object (uses default if not provided)
        """
        self.config = config or Config
        self.client: Optional[OpenAI] = None
        self.total_tokens_used = 0
        self.total_requests = 0
        
        if self.config.OPENAI_API_KEY:
            self.client = OpenAI(
                api_key=self.config.OPENAI_API_KEY,
                timeout=self.config.OPENAI_TIMEOUT
            )
            logger.info("AIService initialized with OpenAI client")
        else:
            logger.warning("AIService initialized without API key - AI features disabled")
    
    @property
    def is_available(self) -> bool:
        """Check if AI service is available"""
        return self.client is not None
    
    def get_usage_stats(self) -> Dict:
        """Get usage statistics"""
        return {
            "total_tokens_used": self.total_tokens_used,
            "total_requests": self.total_requests,
            "estimated_cost_usd": self._estimate_cost()
        }
    
    def _estimate_cost(self) -> float:
        """Estimate cost based on token usage (GPT-4o-mini pricing)"""
        # GPT-4o-mini: $0.15/1M input, $0.60/1M output
        # Rough estimate assuming 70% input, 30% output
        input_tokens = self.total_tokens_used * 0.7
        output_tokens = self.total_tokens_used * 0.3
        return (input_tokens * 0.15 / 1_000_000) + (output_tokens * 0.60 / 1_000_000)
    
    @retry(
        retry=retry_if_exception_type((APIConnectionError,)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10)
    )
    def _call_openai(
        self,
        messages: List[Dict],
        response_format: Optional[Dict] = None,
        temperature: float = 0.1
    ) -> Dict:
        """
        Make a call to OpenAI API with retry logic
        
        Args:
            messages: List of message dictionaries
            response_format: Optional JSON schema for structured output
            temperature: Temperature for response generation
        
        Returns:
            Parsed response content
        
        Raises:
            AIServiceException: If the API call fails
            AIRateLimitException: If rate limit is exceeded
        """
        if not self.client:
            raise AIServiceException("OpenAI client not initialized - missing API key")
        
        try:
            kwargs = {
                "model": self.config.OPENAI_MODEL,
                "messages": messages,
                "temperature": temperature,
            }
            
            if response_format:
                kwargs["response_format"] = response_format
            
            response = self.client.chat.completions.create(**kwargs)
            
            # Track usage
            if response.usage:
                self.total_tokens_used += response.usage.total_tokens
            self.total_requests += 1
            
            content = response.choices[0].message.content
            
            # Parse JSON if response_format was specified
            if response_format and response_format.get("type") == "json_object":
                try:
                    return json.loads(content)
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse JSON response: {e}")
                    raise AIServiceException(f"Invalid JSON response from OpenAI: {e}")
            
            return {"content": content}
            
        except RateLimitError as e:
            logger.error(f"OpenAI rate limit exceeded: {e}")
            raise AIRateLimitException(f"Rate limit exceeded: {e}")
        except APIError as e:
            logger.error(f"OpenAI API error: {e}")
            raise AIServiceException(f"OpenAI API error: {e}")
        except Exception as e:
            logger.error(f"Unexpected error calling OpenAI: {e}")
            raise AIServiceException(f"Failed to call OpenAI: {e}")
    
    def parse_receipt(self, email_content: str) -> Dict:
        """
        Parse receipt from email content using AI
        
        Args:
            email_content: Raw email content (plain text)
        
        Returns:
            Dictionary with parsed receipt data:
            {
                "store_name": str,
                "order_id": str,
                "order_date": str,
                "items": List[Dict],
                "subtotal": float,
                "tax": float,
                "total": float
            }
        """
        system_prompt = """You are a receipt parsing assistant. Extract structured data from grocery receipt emails.

For each line item, extract:
- name: The product name (clean, without quantity info)
- raw_name: The original product name as shown
- price: The price paid (after discounts)
- regular_price: The regular price before discounts (if shown)
- quantity: Number of units purchased
- category: Product category (GROCERY, MEAT, PRODUCE, DAIRY, BAKERY, FROZEN, BEVERAGES, HOUSEHOLD, HEALTH & BEAUTY, DELI, SEAFOOD)
- quantity_info: Object with 'amount' and 'unit' extracted from product name (e.g., "16 oz" -> {"amount": 16, "unit": "oz"})

Return valid JSON only. If you cannot parse something, make your best guess or omit it."""

        user_prompt = f"""Parse this grocery receipt email and extract all items:

{email_content[:8000]}

Return JSON with this structure:
{{
    "store_name": "store name",
    "order_id": "order ID",
    "order_date": "YYYY-MM-DD",
    "items": [
        {{
            "name": "Product Name",
            "raw_name": "Original Product Name 16oz",
            "price": 5.99,
            "regular_price": 7.99,
            "quantity": 1,
            "category": "GROCERY",
            "quantity_info": {{"amount": 16, "unit": "oz"}}
        }}
    ],
    "subtotal": 50.00,
    "tax": 4.50,
    "total": 54.50
}}"""

        response = self._call_openai(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.1
        )
        
        return response
    
    def normalize_products_batch(self, products: List[Dict[str, str]]) -> List[Dict]:
        """
        Normalize a batch of products using AI
        
        Args:
            products: List of dicts with 'raw_name' and 'category' keys
        
        Returns:
            List of normalized product dictionaries
        """
        if not products:
            return []
        
        # Limit batch size
        batch_size = min(len(products), self.config.OPENAI_BATCH_SIZE)
        products = products[:batch_size]
        
        system_prompt = """You are a grocery product normalization assistant. For each product, extract:

1. base_ingredient: The core ingredient (e.g., "butter", "milk", "chicken breast")
2. variant: Important variant that affects cooking (e.g., "unsalted", "whole", "boneless skinless")
3. normalized_name: Combination like "butter (unsalted)" or just "eggs" if no variant
4. product_type: Type like "dairy product", "meat product", "produce", "grain product", "condiment", "beverage", "snack", "grocery item"
5. category: Food category (dairy, meat, produce, pantry, frozen, beverages, bakery, deli, household)
6. tags: Array of relevant tags (organic, fresh, frozen, low-fat, etc.)

Focus on what matters for cooking and pantry management. Ignore brand names."""

        products_json = json.dumps([
            {"raw_name": p["raw_name"], "category": p.get("category", "")}
            for p in products
        ], indent=2)
        
        user_prompt = f"""Normalize these grocery products:

{products_json}

Return JSON array with normalized products in the same order:
{{
    "products": [
        {{
            "raw_name": "original name",
            "base_ingredient": "butter",
            "variant": "unsalted",
            "normalized_name": "butter (unsalted)",
            "product_type": "dairy product",
            "category": "dairy",
            "tags": ["unsalted"]
        }}
    ]
}}"""

        response = self._call_openai(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.1
        )
        
        normalized = response.get("products", [])
        
        # Add metadata
        for item in normalized:
            item["confidence_score"] = 0.95
            item["source"] = "openai"
            item["verified"] = False
        
        return normalized
    
    def detect_store(self, email_content: str) -> Optional[str]:
        """
        Detect which store a receipt is from
        
        Args:
            email_content: Raw email content
        
        Returns:
            Store identifier (lowercase) or None
        """
        system_prompt = """Identify the grocery store from this receipt email. 
Return just the store name in lowercase (e.g., "safeway", "kroger", "walmart", "costco", "target", "whole foods", "trader joes").
If you cannot identify the store, return "unknown"."""

        response = self._call_openai(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": email_content[:2000]}
            ],
            temperature=0.0
        )
        
        store = response.get("content", "").strip().lower()
        return store if store != "unknown" else None


def create_ai_service(config: Optional[Config] = None) -> AIService:
    """
    Factory function to create AIService
    
    Args:
        config: Configuration object
    
    Returns:
        Initialized AIService instance
    """
    return AIService(config)




