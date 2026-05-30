"""
Unit conversions for coffee commodities.

KC (arabica)  → cents / lb
RC (robusta)  → USD / metric tonne
1 metric tonne = 2204.62 lbs
1 saca (bag)   = 60 kg = 132.277 lbs
"""

USD_T_TO_CENTS_LB: float = 100 / 2204.62  # ≈ 0.04536

LBS_PER_SACA: float = 132.277

def rc_to_cents_lb(usd_per_tonne: float) -> float:
    return usd_per_tonne * USD_T_TO_CENTS_LB

def cents_lb_to_reais_saca(cents_per_lb: float, fx_brl_usd: float) -> float:
    return cents_per_lb * LBS_PER_SACA / 100.0 * fx_brl_usd

def usd_per_tonne_to_cents_lb(price: float) -> float:
    return price / 22.0462
