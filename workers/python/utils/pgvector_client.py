"""
pgvector Client: PostgreSQL vector similarity search wrapper
"""
import psycopg2
from psycopg2.extras import RealDictCursor
import numpy as np
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass

@dataclass
class SimilarSymbol:
    """Result dari similarity search"""
    id: str
    asset_type: str
    symbol_category: Optional[str]
    confidence: float  # Cosine similarity score
    crop_path: str
    bbox_dxf: Optional[Dict[str, float]]

class PgVectorClient:
    """
    Client untuk query vector similarity di PostgreSQL dengan pgvector extension
    """
    
    def __init__(self, database_url: str):
        self.database_url = database_url
        self._conn = None
    
    def connect(self):
        """Open database connection"""
        if not self._conn or self._conn.closed:
            self._conn = psycopg2.connect(self.database_url, cursor_factory=RealDictCursor)
        return self._conn
    
    def close(self):
        """Close database connection"""
        if self._conn and not self._conn.closed:
            self._conn.close()
    
    def __enter__(self):
        self.connect()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
    
    def search_similar_symbols(
        self,
        query_embedding: np.ndarray,
        project_id: Optional[str] = None,
        similarity_threshold: float = 0.85,
        limit: int = 10,
        asset_type_filter: Optional[str] = None
    ) -> List[SimilarSymbol]:
        """
        Search approved training symbols similar to query embedding
        
        Args:
            query_embedding: 512-dim numpy array
            project_id: Filter by project (None = search all projects)
            similarity_threshold: Minimum cosine similarity (0-1)
            limit: Max results
            asset_type_filter: Optional filter by asset_type
            
        Returns:
            List of SimilarSymbol sorted by confidence DESC
        """
        conn = self.connect()
        cur = conn.cursor()
        
        # Convert numpy array ke PostgreSQL vector format
        emb_str = '[' + ','.join(map(str, query_embedding.tolist())) + ']'
        
        # Build query dengan optional filters
        conditions = [
            "is_approved = TRUE",
            "embedding IS NOT NULL",
            f"(1 - (embedding <=> '{emb_str}'::vector)) > {similarity_threshold}"
        ]
        
        if project_id:
            conditions.append(f"project_id = '{project_id}'")
        
        if asset_type_filter:
            conditions.append(f"asset_type = '{asset_type_filter}'")
        
        where_clause = " AND ".join(conditions)
        
        query = f"""
            SELECT 
                id::text,
                asset_type,
                symbol_category,
                crop_path,
                bbox_dxf_x_min,
                bbox_dxf_y_min,
                bbox_dxf_x_max,
                bbox_dxf_y_max,
                (1 - (embedding <=> '{emb_str}'::vector))::float AS confidence
            FROM asset_training_embeddings
            WHERE {where_clause}
            ORDER BY embedding <=> '{emb_str}'::vector
            LIMIT {limit}
        """
        
        cur.execute(query)
        rows = cur.fetchall()
        cur.close()
        
        results = []
        for row in rows:
            bbox_dxf = None
            if all(row.get(k) is not None for k in ['bbox_dxf_x_min', 'bbox_dxf_y_min', 'bbox_dxf_x_max', 'bbox_dxf_y_max']):
                bbox_dxf = {
                    'x_min': row['bbox_dxf_x_min'],
                    'y_min': row['bbox_dxf_y_min'],
                    'x_max': row['bbox_dxf_x_max'],
                    'y_max': row['bbox_dxf_y_max']
                }
            
            results.append(SimilarSymbol(
                id=row['id'],
                asset_type=row['asset_type'],
                symbol_category=row.get('symbol_category'),
                confidence=row['confidence'],
                crop_path=row['crop_path'],
                bbox_dxf=bbox_dxf
            ))
        
        return results
    
    def insert_training_embedding(
        self,
        project_id: str,
        detection_id: Optional[str],
        asset_tag: str,
        asset_type: str,
        symbol_category: str,
        crop_path: str,
        embedding: np.ndarray,
        bbox_dxf: Dict[str, float],
        bbox_px: Dict[str, int],
        confidence_original: float,
        approved_by: Optional[str] = None
    ) -> str:
        """
        Insert new approved training embedding
        
        Returns:
            UUID of inserted row
        """
        conn = self.connect()
        cur = conn.cursor()
        
        emb_str = '[' + ','.join(map(str, embedding.tolist())) + ']'
        
        query = """
            INSERT INTO asset_training_embeddings (
                project_id, detection_id, asset_tag, asset_type, symbol_category,
                crop_path, embedding,
                bbox_dxf_x_min, bbox_dxf_y_min, bbox_dxf_x_max, bbox_dxf_y_max,
                bbox_px_x, bbox_px_y, bbox_px_w, bbox_px_h,
                confidence_original, approved_by, is_approved
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s::vector,
                %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, TRUE
            )
            RETURNING id::text
        """
        
        cur.execute(query, (
            project_id, detection_id, asset_tag, asset_type, symbol_category,
            crop_path, emb_str,
            bbox_dxf['x_min'], bbox_dxf['y_min'], bbox_dxf['x_max'], bbox_dxf['y_max'],
            bbox_px['x'], bbox_px['y'], bbox_px['width'], bbox_px['height'],
            confidence_original, approved_by
        ))
        
        result = cur.fetchone()
        conn.commit()
        cur.close()
        
        return result['id']
    
    def update_legend_embedding(self, legend_symbol_id: str, embedding: np.ndarray):
        """Update embedding column di legend_symbols table"""
        conn = self.connect()
        cur = conn.cursor()
        
        emb_str = '[' + ','.join(map(str, embedding.tolist())) + ']'
        
        query = "UPDATE legend_symbols SET embedding = %s::vector WHERE id = %s"
        cur.execute(query, (emb_str, legend_symbol_id))
        
        conn.commit()
        cur.close()
