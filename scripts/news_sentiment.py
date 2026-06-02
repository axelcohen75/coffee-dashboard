"""Coffee news sentiment classification.

Sentiment is framed in supply & demand terms, not only price words:
  - supply DOWN  (drought, frost, deficit, lower output)        -> bullish
  - supply UP    (record crop, bumper harvest, higher output)   -> bearish
  - demand UP    (strong demand, consumption growth)            -> bullish
  - demand DOWN  (weak demand)                                  -> bearish
  - price UP / price DOWN add a smaller confirmation weight.

Phrases are matched on word boundaries so short words (e.g. "up")
do not match inside other words (e.g. "supply").
"""

from __future__ import annotations

import re

# (phrase, weight). Multi-word supply/demand cues get a higher weight than
# generic single price words so they win when both appear in the same text.
BULLISH: list[tuple[str, int]] = [
    # price up (confirmation only)
    ("surge", 1), ("surges", 1), ("surged", 1), ("soar", 1), ("soars", 1), ("soared", 1),
    ("rally", 1), ("rallies", 1), ("rallied", 1), ("jump", 1), ("jumps", 1), ("jumped", 1),
    ("rise", 1), ("rises", 1), ("rose", 1), ("rising", 1), ("gain", 1), ("gains", 1),
    ("higher", 1), ("climb", 1), ("climbs", 1), ("climbing", 1), ("spike", 1), ("spikes", 1),
    ("strengthen", 1), ("strengthens", 1), ("firmer", 1), ("record high", 1), ("price spike", 1),
    # supply DOWN -> bullish
    ("shortage", 2), ("shortages", 2), ("deficit", 2), ("supply deficit", 2),
    ("tight supply", 2), ("tight supplies", 2), ("supply concern", 2), ("supply concerns", 2),
    ("supply disruption", 2), ("drought", 2), ("frost", 2), ("frosts", 2), ("freeze", 2),
    ("crop damage", 2), ("crop loss", 2), ("crop losses", 2), ("lower output", 2),
    ("output decline", 2), ("production cut", 2), ("production cuts", 2), ("production decline", 2),
    ("reduced harvest", 2), ("smaller crop", 2), ("poor harvest", 2), ("low stocks", 2),
    ("declining stocks", 2), ("inventory draw", 2), ("export ban", 2), ("lower exports", 2),
    ("backwardation", 2),
    # demand UP -> bullish
    ("strong demand", 2), ("robust demand", 2), ("demand growth", 2), ("demand recovery", 2),
    ("rising demand", 2), ("higher demand", 2), ("consumption growth", 2), ("record demand", 2),
    # French
    ("hausse", 1), ("en hausse", 1), ("rebond", 1), ("rebondit", 1), ("rallye", 1),
    ("flambée", 1), ("flambee", 1), ("grimpe", 1), ("progresse", 1),
    ("pénurie", 2), ("penurie", 2), ("déficit", 2), ("sécheresse", 2), ("secheresse", 2),
    ("gel", 2), ("gelée", 2), ("offre tendue", 2), ("baisse de production", 2),
    ("récolte réduite", 2), ("recolte reduite", 2), ("forte demande", 2),
    ("reprise de la demande", 2), ("stocks bas", 2),
]

BEARISH: list[tuple[str, int]] = [
    # price down (confirmation only)
    ("fall", 1), ("falls", 1), ("fell", 1), ("falling", 1), ("drop", 1), ("drops", 1),
    ("dropped", 1), ("decline", 1), ("declines", 1), ("declined", 1), ("slump", 1),
    ("slumps", 1), ("plunge", 1), ("plunges", 1), ("plunged", 1), ("slide", 1), ("slides", 1),
    ("lower", 1), ("tumble", 1), ("tumbles", 1), ("sink", 1), ("sinks", 1), ("retreat", 1),
    ("weaken", 1), ("weakens", 1), ("weaker", 1), ("selloff", 1), ("sell-off", 1),
    ("hammer", 1), ("hammers", 1), ("hammered", 1), ("slips", 1), ("slipped", 1),
    # supply UP -> bearish
    ("surplus", 2), ("glut", 2), ("oversupply", 2), ("over-supply", 2), ("bumper crop", 2),
    ("bumper harvest", 2), ("record harvest", 2), ("record crop", 2), ("record production", 2),
    ("record output", 2), ("production growth", 2), ("higher output", 2), ("output increase", 2),
    ("output rises", 2), ("supply growth", 2), ("supply increase", 2), ("rising production", 2),
    ("increased production", 2), ("larger crop", 2), ("bigger crop", 2), ("abundant", 2),
    ("ample supply", 2), ("ample supplies", 2), ("good harvest", 2), ("strong harvest", 2),
    ("favorable weather", 2), ("favourable weather", 2), ("beneficial rains", 2),
    ("harvest pressure", 2), ("harvest resumes", 2), ("harvest resumption", 2),
    ("resumption", 2), ("export recovery", 2), ("rising exports", 2), ("higher exports", 2),
    ("export surge", 2), ("inventory build", 2), ("stocks build", 2), ("rising stocks", 2),
    ("record growth in coffee production", 3), ("record growth in production", 3),
    ("record coffee harvest", 2), ("record coffee crop", 2), ("record coffee production", 2),
    ("undercut", 1), ("undercuts", 1), ("real weakness", 1), ("weaker real", 1), ("weak real", 1),
    # demand DOWN -> bearish
    ("weak demand", 2), ("weaker demand", 2), ("demand decline", 2), ("falling demand", 2),
    ("lower demand", 2), ("soft demand", 2), ("sluggish demand", 2), ("contango", 2),
    # French
    ("baisse", 1), ("en baisse", 1), ("chute", 1), ("chutent", 1), ("recul", 1), ("recule", 1),
    ("plonge", 1), ("glissement", 1),
    ("surplus", 2), ("offre abondante", 2), ("récolte record", 2), ("recolte record", 2),
    ("production record", 2), ("croissance record", 2), ("hausse de production", 2),
    ("reprise des exportations", 2), ("pression de récolte", 2), ("faible demande", 2),
    ("demande faible", 2), ("stocks en hausse", 2), ("beau temps", 2), ("conditions favorables", 2),
]


def _compile(phrases: list[tuple[str, int]]) -> list[tuple[re.Pattern, int]]:
    compiled = []
    for phrase, weight in phrases:
        pattern = re.compile(r"(?<!\w)" + re.escape(phrase) + r"(?!\w)", re.IGNORECASE)
        compiled.append((pattern, weight))
    return compiled


_BULL = _compile(BULLISH)
_BEAR = _compile(BEARISH)


def _score(patterns: list[tuple[re.Pattern, int]], text: str) -> int:
    return sum(weight for pattern, weight in patterns if pattern.search(text))


def classify_sentiment(title: str, summary: str = "") -> str:
    text = f"{title} {summary}"
    bull = _score(_BULL, text)
    bear = _score(_BEAR, text)
    if bull > bear:
        return "BULL"
    if bear > bull:
        return "BEAR"
    return "NEUTRAL"
